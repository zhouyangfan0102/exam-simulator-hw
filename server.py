from __future__ import annotations

import json
import random
import re
import shutil
import sys
import time
import uuid
import zipfile
from dataclasses import dataclass
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote, unquote, urlparse
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DATA_FILE = DATA_DIR / "题库.xlsx"
BANK_META_FILE = DATA_DIR / "bank_meta.json"
HOST = "127.0.0.1"
DEFAULT_PORT = 8000
EXAMS: dict[str, dict[str, Any]] = {}
QUESTION_TYPE_ORDER = ("判断题", "单选题", "多选题")
RANDOM_EXAM_LIMIT = 30
TEMPLATE_FILENAME = "题库模板.xlsx"


class WorkbookReadError(Exception):
    pass


class UploadReadError(Exception):
    pass


class QuestionFormatError(Exception):
    pass


@dataclass
class Question:
    id: str
    subject: str
    row: int
    qtype: str
    answer: str
    question: str

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "subject": self.subject,
            "row": self.row,
            "type": self.qtype,
            "question": self.question,
        }


@dataclass
class ParsedQuestion:
    qtype: str
    answer: str
    stem: str
    options: list[str]


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def attr_by_local_name(element: ET.Element, name: str) -> str | None:
    for key, value in element.attrib.items():
        if local_name(key) == name:
            return value
    return None


def normalize_target(target: str) -> str:
    target = target.replace("\\", "/")
    if target.startswith("/"):
        return target.lstrip("/")
    return f"xl/{target}"


def read_text_nodes(element: ET.Element) -> str:
    parts: list[str] = []
    for child in element.iter():
        if local_name(child.tag) == "t" and child.text:
            parts.append(child.text)
    return "".join(parts)


def load_shared_strings(book: zipfile.ZipFile) -> list[str]:
    try:
        raw = book.read("xl/sharedStrings.xml")
    except KeyError:
        return []

    root = ET.fromstring(raw)
    strings: list[str] = []
    for si in root:
        if local_name(si.tag) == "si":
            strings.append(read_text_nodes(si))
    return strings


def load_sheet_paths(book: zipfile.ZipFile) -> list[tuple[str, str]]:
    try:
        workbook = ET.fromstring(book.read("xl/workbook.xml"))
        rels = ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))
    except KeyError as exc:
        raise WorkbookReadError("Excel 文件结构不完整，无法读取工作表。") from exc

    rel_targets: dict[str, str] = {}
    for rel in rels:
        rel_id = rel.attrib.get("Id")
        target = rel.attrib.get("Target")
        if rel_id and target:
            rel_targets[rel_id] = normalize_target(target)

    sheets: list[tuple[str, str]] = []
    for element in workbook.iter():
        if local_name(element.tag) != "sheet":
            continue
        name = element.attrib.get("name", "").strip()
        rel_id = attr_by_local_name(element, "id")
        if name and rel_id and rel_id in rel_targets:
            sheets.append((name, rel_targets[rel_id]))
    return sheets


def column_name(cell_ref: str) -> str:
    match = re.match(r"([A-Za-z]+)", cell_ref or "")
    return match.group(1).upper() if match else ""


def cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get("t", "")
    value_element = None
    for child in cell:
        if local_name(child.tag) == "v":
            value_element = child
            break

    if cell_type == "inlineStr":
        return read_text_nodes(cell).strip()
    if value_element is None or value_element.text is None:
        return ""

    raw = value_element.text.strip()
    if cell_type == "s":
        try:
            return shared_strings[int(raw)].strip()
        except (ValueError, IndexError):
            return raw
    if cell_type == "b":
        return "TRUE" if raw == "1" else "FALSE"
    return raw


def xml_escape(value: str) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def excel_column_name(index: int) -> str:
    name = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def excel_column_index(name: str) -> int:
    index = 0
    for char in name.upper():
        if not ("A" <= char <= "Z"):
            continue
        index = index * 26 + ord(char) - 64
    return index


def build_template_sheet(rows: list[list[str]]) -> str:
    row_xml: list[str] = []
    for row_index, row_values in enumerate(rows, start=1):
        cells = []
        for col_index, value in enumerate(row_values, start=1):
            cell_ref = f"{excel_column_name(col_index)}{row_index}"
            text = xml_escape(value)
            cells.append(f'<c r="{cell_ref}" t="inlineStr"><is><t xml:space="preserve">{text}</t></is></c>')
        row_xml.append(f'<row r="{row_index}">{"".join(cells)}</row>')
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>
    <col min="1" max="1" width="14" customWidth="1"/>
    <col min="2" max="2" width="14" customWidth="1"/>
    <col min="3" max="3" width="72" customWidth="1"/>
  </cols>
  <sheetData>
    {''.join(row_xml)}
  </sheetData>
</worksheet>"""


def safe_sheet_name(name: str, fallback: str = "整理题库") -> str:
    cleaned = re.sub(r"[\[\]:*?/\\]", "_", str(name or "").strip())
    cleaned = cleaned.strip("'") or fallback
    return cleaned[:31]


def unique_sheet_name(name: str, used: set[str]) -> str:
    base = safe_sheet_name(name)
    candidate = base
    index = 2
    while candidate in used:
        suffix = f"_{index}"
        candidate = f"{base[: 31 - len(suffix)]}{suffix}"
        index += 1
    used.add(candidate)
    return candidate


def build_xlsx_workbook(sheets: list[tuple[str, list[list[str]]]]) -> bytes:
    sheet_entries = []
    rel_entries = []
    overrides = []
    worksheet_files: dict[str, str] = {}
    used_names: set[str] = set()
    for index, (name, rows) in enumerate(sheets, start=1):
        sheet_name = unique_sheet_name(name, used_names)
        sheet_entries.append(f'<sheet name="{xml_escape(sheet_name)}" sheetId="{index}" r:id="rId{index}"/>')
        rel_entries.append(
            f'<Relationship Id="rId{index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{index}.xml"/>'
        )
        overrides.append(
            f'<Override PartName="/xl/worksheets/sheet{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        )
        worksheet_files[f"xl/worksheets/sheet{index}.xml"] = build_template_sheet(rows)

    workbook_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    {''.join(sheet_entries)}
  </sheets>
</workbook>"""
    workbook_rels_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  {''.join(rel_entries)}
</Relationships>"""
    content_types_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  {''.join(overrides)}
</Types>"""
    root_rels_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"""

    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types_xml)
        archive.writestr("_rels/.rels", root_rels_xml)
        archive.writestr("xl/workbook.xml", workbook_xml)
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_rels_xml)
        for filename, content in worksheet_files.items():
            archive.writestr(filename, content)
    return buffer.getvalue()


def build_question_bank_template() -> bytes:
    sheets = [
        (
            "判断题示例",
            [
                ["题型", "答案", "问题"],
                ["判断题", "对", "Excel 的每个 sheet 页标签会被系统识别为一门学科。"],
                ["判断题", "错", "判断题答案必须填写 A 或 B。"],
            ],
        ),
        (
            "单选题示例",
            [
                ["题型", "答案", "问题"],
                ["单选题", "A", "系统读取题库时，哪一列表示题型？"],
                ["", "", "A. A列"],
                ["", "", "B. B列"],
                ["", "", "C. C列"],
                ["", "", "D. D列"],
                ["单选题", "C", "问题内容应该填写在哪一列？"],
                ["", "", "A. A列"],
                ["", "", "B. B列"],
                ["", "", "C. C列"],
                ["", "", "D. D列"],
            ],
        ),
        (
            "多选题示例",
            [
                ["题型", "答案", "问题"],
                ["多选题", "ABC", "题库 Excel 中必须包含哪些字段？"],
                ["", "", "A. 题型"],
                ["", "", "B. 答案"],
                ["", "", "C. 问题"],
                ["", "", "D. 分数"],
                ["多选题", "AC", "下列哪些题型已支持？"],
                ["", "", "A. 判断题"],
                ["", "", "B. 填空题"],
                ["", "", "C. 多选题"],
                ["", "", "D. 问答题"],
            ],
        ),
    ]
    return build_xlsx_workbook(sheets)


def looks_like_header(qtype: str, answer: str, question: str) -> bool:
    def clean(value: str) -> str:
        return re.sub(r"\s+", "", value).lower()

    a, b, c = clean(qtype), clean(answer), clean(question)
    type_words = {"题型", "类型", "questiontype", "type"}
    answer_words = {"答案", "正确答案", "answer", "answers"}
    question_words = {"问题", "题目", "question", "questions"}
    return a in type_words and b in answer_words and c in question_words


def compact_header(value: str) -> str:
    return re.sub(r"\s+", "", normalize_fullwidth(value)).lower()


def detect_question_type(value: str) -> str:
    text = normalize_fullwidth(value)
    compact = re.sub(r"\s+", "", text)
    if "判断" in compact or compact in {"truefalse", "t/f"}:
        return "判断题"
    if "多选" in compact or "多项" in compact or ("多" in compact and "选" in compact):
        return "多选题"
    if "单选" in compact or "单项" in compact or ("单" in compact and "选" in compact):
        return "单选题"
    return ""


def strip_question_type(value: str) -> str:
    text = normalize_fullwidth(value)
    patterns = [
        r"^\s*[\[【(（]?\s*(?:判断题?|单选题?|单项选择题?|多选题?|多项选择题?)\s*[\]】)）]?\s*[:：、.-]?\s*",
        r"\s*[\[【(（]\s*(?:判断题?|单选题?|单项选择题?|多选题?|多项选择题?)\s*[\]】)）]\s*",
    ]
    for pattern in patterns:
        text = re.sub(pattern, "", text)
    return text.strip()


def strip_question_number(value: str) -> str:
    text = normalize_fullwidth(value)
    text = re.sub(r"^\s*(?:第\s*)?\d+\s*(?:题|[、.．)）])\s*", "", text)
    text = re.sub(r"^\s*[(（]\s*\d+\s*[)）]\s*", "", text)
    return text.strip()


def option_match(value: str) -> re.Match[str] | None:
    return re.match(r"^\s*([A-Ha-hＡ-Ｈａ-ｈ])\s*[\.\uFF0E、:：\)）]\s*(.+?)\s*$", normalize_fullwidth(value))


def normalize_option_line(value: str) -> str:
    match = option_match(value)
    if not match:
        return normalize_fullwidth(value).strip()
    return f"{normalize_fullwidth(match.group(1)).upper()}. {match.group(2).strip()}"


def normalize_answer_value(value: str) -> str:
    text = normalize_fullwidth(value)
    text = re.sub(r"^\s*(?:正确答案|参考答案|答案|answer|ans)\s*[:：]?\s*", "", text, flags=re.IGNORECASE)
    text = text.strip()
    bool_answer = normalize_bool(text)
    if bool_answer == "TRUE":
        return "对"
    if bool_answer == "FALSE":
        return "错"
    letters = re.findall(r"[A-Ha-h]", text)
    if letters and len("".join(letters)) >= max(1, len(re.sub(r"[^A-Ha-h]", "", text))):
        return "".join(letter.upper() for letter in letters)
    return text


def split_inline_answer(value: str) -> tuple[str, str]:
    text = normalize_fullwidth(value)
    pattern = r"(?:正确答案|参考答案|答案|answer|ans)\s*[:：]?\s*([A-Ha-hＡ-Ｈａ-ｈ\s,，、;；/|]+|对|错|正确|错误|TRUE|FALSE|true|false)\s*$"
    match = re.search(pattern, text, flags=re.IGNORECASE)
    if not match:
        return text.strip(), ""
    return text[: match.start()].strip(), normalize_answer_value(match.group(1))


def infer_question_type(explicit_type: str, answer: str, options: list[str]) -> str:
    if explicit_type:
        return explicit_type
    if normalize_bool(answer) or normalize_answer_value(answer) in {"对", "错"}:
        return "判断题"
    compact_answer = re.sub(r"[^A-H]", "", normalize_fullwidth(answer).upper())
    if len(compact_answer) > 1:
        return "多选题"
    if options:
        return "单选题"
    return "单选题"


def finalize_question(item: ParsedQuestion | None, output: list[ParsedQuestion]) -> None:
    if not item:
        return
    item.stem = strip_question_number(strip_question_type(item.stem)).strip()
    item.options = [normalize_option_line(option) for option in item.options if normalize_option_line(option)]
    item.answer = normalize_answer_value(item.answer)
    item.qtype = infer_question_type(detect_question_type(item.qtype), item.answer, item.options)
    if item.stem:
        output.append(item)


def parse_text_lines(lines: list[str]) -> list[ParsedQuestion]:
    output: list[ParsedQuestion] = []
    current: ParsedQuestion | None = None
    for raw_line in lines:
        line = normalize_fullwidth(raw_line)
        line = re.sub(r"\s+", " ", line).strip()
        if not line:
            continue

        answer_line = re.match(r"^\s*(?:正确答案|参考答案|答案|answer|ans)\s*[:：]?\s*(.+)$", line, flags=re.IGNORECASE)
        if answer_line and current:
            current.answer = normalize_answer_value(answer_line.group(1))
            continue

        option = option_match(line)
        if option and current:
            current.options.append(normalize_option_line(line))
            continue

        qtype = detect_question_type(line)
        cleaned_line, inline_answer = split_inline_answer(line)
        cleaned_line = strip_question_number(strip_question_type(cleaned_line))
        if current and not option and not answer_line:
            finalize_question(current, output)
        current = ParsedQuestion(qtype=qtype, answer=inline_answer, stem=cleaned_line, options=[])

    finalize_question(current, output)
    return output


def question_to_rows(question: ParsedQuestion) -> list[list[str]]:
    rows = [[question.qtype, question.answer, question.stem]]
    rows.extend(["", "", option] for option in question.options)
    return rows


def build_formatted_question_bank(subjects: list[tuple[str, list[ParsedQuestion]]]) -> bytes:
    sheets = []
    for subject, questions in subjects:
        rows = [["题型", "答案", "问题"]]
        for question in questions:
            rows.extend(question_to_rows(question))
        sheets.append((subject, rows))
    if not sheets:
        raise QuestionFormatError("没有识别到可整理的题目。")
    return build_xlsx_workbook(sheets)


def read_docx_lines(file_data: bytes) -> list[str]:
    try:
        with zipfile.ZipFile(BytesIO(file_data)) as archive:
            document_xml = archive.read("word/document.xml")
    except (KeyError, zipfile.BadZipFile) as exc:
        raise QuestionFormatError("Word 文件需要是 .docx 格式，并且文件结构正常。") from exc

    try:
        root = ET.fromstring(document_xml)
    except ET.ParseError as exc:
        raise QuestionFormatError("Word 文档内容解析失败，请先重新保存为 .docx。") from exc

    lines: list[str] = []
    for paragraph in root.iter():
        if local_name(paragraph.tag) != "p":
            continue
        text = read_text_nodes(paragraph).strip()
        if text:
            lines.extend(part.strip() for part in re.split(r"[\r\n]+", text) if part.strip())
    return lines


def read_xlsx_rows(file_data: bytes) -> list[tuple[str, list[list[str]]]]:
    try:
        with zipfile.ZipFile(BytesIO(file_data)) as book:
            shared_strings = load_shared_strings(book)
            sheets = load_sheet_paths(book)
            result = []
            for subject, sheet_path in sheets:
                try:
                    root = ET.fromstring(book.read(sheet_path))
                except KeyError as exc:
                    raise WorkbookReadError(f"无法读取工作表：{subject}") from exc
                rows: list[list[str]] = []
                for row in root.iter():
                    if local_name(row.tag) != "row":
                        continue
                    values_by_col: dict[int, str] = {}
                    for cell in row:
                        if local_name(cell.tag) != "c":
                            continue
                        index = excel_column_index(column_name(cell.attrib.get("r", "")))
                        if index:
                            values_by_col[index] = cell_value(cell, shared_strings)
                    if not values_by_col:
                        continue
                    max_col = max(values_by_col)
                    values = [values_by_col.get(index, "").strip() for index in range(1, max_col + 1)]
                    if any(values):
                        rows.append(values)
                result.append((subject, rows))
            return result
    except zipfile.BadZipFile as exc:
        raise QuestionFormatError("Excel 文件不是有效的 .xlsx 文件。") from exc
    except ET.ParseError as exc:
        raise QuestionFormatError("Excel XML 解析失败，请确认文件保存正常。") from exc


def header_index(headers: list[str], words: set[str]) -> int | None:
    for index, header in enumerate(headers):
        compact = compact_header(header)
        if compact in words or any(word in compact for word in words):
            return index
    return None


def option_header_index(headers: list[str]) -> list[int]:
    indexes = []
    for index, header in enumerate(headers):
        compact = compact_header(header).upper()
        if re.fullmatch(r"(?:选项)?[A-H]", compact):
            indexes.append(index)
    return indexes


def option_key_from_header(header: str) -> str:
    compact = compact_header(header).upper()
    match = re.search(r"([A-H])$", compact)
    return match.group(1) if match else ""


def parse_table_rows(rows: list[list[str]]) -> list[ParsedQuestion]:
    first_row = next((row for row in rows if any(cell.strip() for cell in row)), [])
    headers = first_row
    qtype_idx = header_index(headers, {"题型", "类型", "questiontype", "type"})
    answer_idx = header_index(headers, {"答案", "正确答案", "参考答案", "answer", "answers"})
    question_idx = header_index(headers, {"问题", "题目", "题干", "question", "questions"})
    option_indexes = option_header_index(headers)
    if question_idx is None or answer_idx is None:
        return []

    parsed: list[ParsedQuestion] = []
    for row in rows[1:]:
        question_text = row[question_idx].strip() if question_idx < len(row) else ""
        answer = row[answer_idx].strip() if answer_idx < len(row) else ""
        if not question_text:
            continue
        qtype = row[qtype_idx].strip() if qtype_idx is not None and qtype_idx < len(row) else ""
        options = []
        for index in option_indexes:
            if index >= len(row) or not row[index].strip():
                continue
            option_text = row[index].strip()
            key = option_key_from_header(headers[index])
            if key and not option_match(option_text):
                option_text = f"{key}. {option_text}"
            options.append(option_text)
        item = ParsedQuestion(qtype=detect_question_type(qtype), answer=answer, stem=question_text, options=options)
        finalize_question(item, parsed)
    return parsed


def parse_standard_rows(rows: list[list[str]]) -> list[ParsedQuestion]:
    parsed: list[ParsedQuestion] = []
    current: ParsedQuestion | None = None
    saw_standard_shape = False
    for row in rows:
        padded = (row + ["", "", ""])[:3]
        qtype, answer, question_text = (value.strip() for value in padded)
        if not any([qtype, answer, question_text]):
            continue
        if looks_like_header(qtype, answer, question_text):
            saw_standard_shape = True
            continue
        if not qtype and not answer and question_text and current:
            saw_standard_shape = True
            current.options.append(question_text)
            continue
        if detect_question_type(qtype) or answer or question_text:
            if not question_text:
                continue
            saw_standard_shape = True
            finalize_question(current, parsed)
            current = ParsedQuestion(qtype=detect_question_type(qtype), answer=answer, stem=question_text, options=[])
    finalize_question(current, parsed)
    return parsed if saw_standard_shape else []


def parse_excel_questions(file_data: bytes) -> list[tuple[str, list[ParsedQuestion]]]:
    subjects: list[tuple[str, list[ParsedQuestion]]] = []
    for subject, rows in read_xlsx_rows(file_data):
        questions = parse_table_rows(rows)
        if not questions:
            questions = parse_standard_rows(rows)
        if not questions:
            lines = [" ".join(cell for cell in row if cell.strip()) for row in rows]
            questions = parse_text_lines(lines)
        if questions:
            subjects.append((subject, questions))
    return subjects


def format_uploaded_question_list(filename: str, file_data: bytes) -> tuple[bytes, int]:
    ext = Path(filename).suffix.lower()
    if ext == ".docx":
        subject = Path(filename).stem or "整理题库"
        subjects = [(subject, parse_text_lines(read_docx_lines(file_data)))]
    elif ext == ".xlsx":
        subjects = parse_excel_questions(file_data)
    else:
        raise QuestionFormatError("暂时支持 .docx 和 .xlsx 文件整理。")

    question_count = sum(len(questions) for _, questions in subjects)
    if question_count <= 0:
        raise QuestionFormatError("没有识别到题目。请确认清单中包含题干、选项和答案等信息。")
    return build_formatted_question_bank(subjects), question_count


def safe_filename(filename: str) -> str:
    name = Path(filename or "").name.strip()
    name = re.sub(r'[\\/:*?"<>|]+', "_", name)
    return name or "题库.xlsx"


def decode_multipart_filename(filename: str) -> str:
    try:
        return filename.encode("latin1").decode("utf-8")
    except UnicodeError:
        return filename


def load_bank_meta() -> dict[str, str]:
    try:
        raw = BANK_META_FILE.read_text(encoding="utf-8")
        meta = json.loads(raw)
    except (OSError, json.JSONDecodeError):
        return {}
    return {str(key): str(value) for key, value in meta.items()}


def save_bank_meta(filename: str, display_name: str) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    BANK_META_FILE.write_text(
        json.dumps({"filename": filename, "displayName": display_name}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def current_question_bank_path() -> Path:
    meta = load_bank_meta()
    filename = safe_filename(meta.get("filename", ""))
    if filename:
        candidate = DATA_DIR / filename
        if candidate.exists():
            return candidate
    return DATA_FILE


def current_bank_display_name(path: Path) -> str:
    meta = load_bank_meta()
    if path.name == meta.get("filename") and meta.get("displayName"):
        return meta["displayName"]
    return path.name


def available_question_bank_paths() -> list[Path]:
    if not DATA_DIR.exists():
        return []
    current_path = current_question_bank_path()
    paths = [
        path
        for path in DATA_DIR.glob("*.xlsx")
        if path.is_file() and not path.name.startswith(".")
    ]
    return sorted(paths, key=lambda path: (path != current_path, path.name.casefold()))


def resolve_question_bank_path(filename: str) -> Path:
    raw_name = str(filename or "").strip()
    if not raw_name:
        return current_question_bank_path()
    if Path(raw_name).name != raw_name or Path(raw_name).suffix.lower() != ".xlsx":
        raise WorkbookReadError("题库文件名不正确。")
    path = DATA_DIR / raw_name
    if not path.is_file():
        raise WorkbookReadError("所选题库不存在，请重新读取题库列表。")
    return path


def load_question_bank(path: Path | None = None) -> dict[str, Any]:
    path = path or current_question_bank_path()
    if not path.exists():
        return {
            "file": str(path.relative_to(ROOT)),
            "filename": path.name,
            "name": current_bank_display_name(path),
            "subjects": [],
            "total": 0,
            "questions": [],
            "message": "未找到 data/题库.xlsx，请把题库 Excel 放到 data 文件夹中。",
        }

    try:
        with zipfile.ZipFile(path) as book:
            shared_strings = load_shared_strings(book)
            sheets = load_sheet_paths(book)
            questions: list[Question] = []

            for subject, sheet_path in sheets:
                try:
                    root = ET.fromstring(book.read(sheet_path))
                except KeyError as exc:
                    raise WorkbookReadError(f"无法读取工作表：{subject}") from exc

                first_data_row = True
                last_question: Question | None = None
                for row in root.iter():
                    if local_name(row.tag) != "row":
                        continue
                    row_number = int(row.attrib.get("r", "0") or 0)
                    cells: dict[str, str] = {}
                    for cell in row:
                        if local_name(cell.tag) != "c":
                            continue
                        col = column_name(cell.attrib.get("r", ""))
                        if col in {"A", "B", "C"}:
                            cells[col] = cell_value(cell, shared_strings)

                    qtype = cells.get("A", "").strip()
                    answer = cells.get("B", "").strip()
                    question_text = cells.get("C", "").strip()
                    if not any([qtype, answer, question_text]):
                        continue
                    if first_data_row and looks_like_header(qtype, answer, question_text):
                        first_data_row = False
                        continue
                    first_data_row = False
                    if not question_text:
                        continue
                    if not qtype and not answer and last_question:
                        last_question.question = f"{last_question.question}\n{question_text}"
                        continue

                    question_id = f"{subject}::{row_number}::{len(questions) + 1}"
                    last_question = Question(
                        id=question_id,
                        subject=subject,
                        row=row_number,
                        qtype=qtype or "未分类",
                        answer=answer,
                        question=question_text,
                    )
                    questions.append(last_question)
    except zipfile.BadZipFile as exc:
        raise WorkbookReadError("题库文件不是有效的 .xlsx 文件。") from exc
    except ET.ParseError as exc:
        raise WorkbookReadError("题库 XML 解析失败，请确认 Excel 文件保存正常。") from exc

    counts: dict[str, int] = {}
    for question in questions:
        counts[question.subject] = counts.get(question.subject, 0) + 1

    return {
        "file": str(path.relative_to(ROOT)),
        "filename": path.name,
        "name": current_bank_display_name(path),
        "subjects": [{"name": name, "count": count} for name, count in counts.items()],
        "total": len(questions),
        "questions": questions,
        "message": "",
    }


def available_question_banks() -> list[dict[str, Any]]:
    banks: list[dict[str, Any]] = []
    for path in available_question_bank_paths():
        try:
            bank = load_question_bank(path)
        except WorkbookReadError:
            continue
        banks.append(
            {
                "filename": path.name,
                "name": bank["name"],
                "total": bank["total"],
            }
        )
    return banks


def question_bank_payload(bank: dict[str, Any], message: str | None = None) -> dict[str, Any]:
    payload = {
        "file": bank["file"],
        "filename": bank["filename"],
        "name": bank["name"],
        "subjects": bank["subjects"],
        "total": bank["total"],
        "message": bank["message"] if message is None else message,
        "currentBank": {
            "filename": bank["filename"],
            "name": bank["name"],
            "total": bank["total"],
        },
        "banks": available_question_banks(),
    }
    return payload


def search_question_bank(path: Path, query: str, limit: int = 80) -> dict[str, Any]:
    bank = load_question_bank(path)
    raw_terms = [term for term in re.split(r"\s+", query.strip()) if term]
    terms = [normalize_fullwidth(term).casefold() for term in raw_terms]
    compact_terms = [re.sub(r"\s+", "", term) for term in terms]
    matches: list[dict[str, Any]] = []

    if terms:
        for question in bank["questions"]:
            searchable = normalize_fullwidth(
                " ".join([question.subject, question.qtype, question.answer, question.question])
            ).casefold()
            compact_searchable = re.sub(r"\s+", "", searchable)
            if not all(
                term in searchable or compact_term in compact_searchable
                for term, compact_term in zip(terms, compact_terms)
            ):
                continue
            matches.append(
                {
                    "id": question.id,
                    "subject": question.subject,
                    "row": question.row,
                    "type": question.qtype,
                    "answer": question.answer,
                    "question": question.question,
                }
            )

    total = len(matches)
    return {
        "filename": path.name,
        "name": bank["name"],
        "query": query,
        "total": total,
        "questions": matches[:limit],
        "truncated": total > limit,
    }


def parse_multipart_upload(
    body: bytes,
    content_type: str,
    allowed_exts: tuple[str, ...] = (".xlsx",),
) -> tuple[str, bytes]:
    match = re.search(r'boundary=(?:"([^"]+)"|([^;]+))', content_type)
    if not match:
        raise UploadReadError("上传请求缺少边界信息。")
    boundary = (match.group(1) or match.group(2)).encode("latin1")
    delimiter = b"--" + boundary

    for part in body.split(delimiter):
        part = part.strip(b"\r\n")
        if not part or part == b"--":
            continue
        if part.endswith(b"--"):
            part = part[:-2].rstrip(b"\r\n")
        if b"\r\n\r\n" not in part:
            continue
        header_raw, file_data = part.split(b"\r\n\r\n", 1)
        headers = header_raw.decode("latin1", errors="replace")
        disposition = next((line for line in headers.split("\r\n") if line.lower().startswith("content-disposition:")), "")
        if 'name="file"' not in disposition:
            continue
        filename_star = re.search(r"filename\*=([^;]+)", disposition)
        if filename_star:
            encoded = filename_star.group(1).strip().strip('"')
            filename = unquote(encoded.split("''", 1)[1] if "''" in encoded else encoded)
        else:
            filename_match = re.search(r'filename="([^"]*)"', disposition)
            filename = decode_multipart_filename(filename_match.group(1)) if filename_match else ""
        filename = safe_filename(filename)
        if not filename.lower().endswith(allowed_exts):
            allowed_text = "、".join(allowed_exts)
            raise UploadReadError(f"请上传 {allowed_text} 格式的文件。")
        if not file_data:
            raise UploadReadError("上传的文件为空。")
        return filename, file_data

    raise UploadReadError("没有读取到上传的 Excel 文件。")


def normalize_fullwidth(value: str) -> str:
    chars = []
    for char in str(value):
        code = ord(char)
        if code == 0x3000:
            chars.append(" ")
        elif 0xFF01 <= code <= 0xFF5E:
            chars.append(chr(code - 0xFEE0))
        else:
            chars.append(char)
    return "".join(chars).strip()


def normalize_bool(value: str) -> str | None:
    cleaned = re.sub(r"[\s.。:：,，、;；/|]+", "", normalize_fullwidth(value)).upper()
    true_values = {"TRUE", "T", "YES", "Y", "1", "对", "正确", "是", "√", "V"}
    false_values = {"FALSE", "F", "NO", "N", "0", "错", "错误", "否", "×", "X"}
    if cleaned in true_values:
        return "TRUE"
    if cleaned in false_values:
        return "FALSE"
    return None


def compact_answer(value: str) -> str:
    cleaned = normalize_fullwidth(value).upper()
    cleaned = re.sub(r"\s+", "", cleaned)
    cleaned = re.sub(r"[,，、;；/|]+", "", cleaned)
    cleaned = re.sub(r"[.。:：]", "", cleaned)
    return cleaned


def answer_matches(correct: str, given: str, qtype: str) -> bool:
    correct_text = normalize_fullwidth(correct)
    given_text = normalize_fullwidth(given)
    if correct_text.casefold() == given_text.casefold():
        return True

    correct_bool = normalize_bool(correct_text)
    given_bool = normalize_bool(given_text)
    if correct_bool and given_bool:
        return correct_bool == given_bool

    compact_correct = compact_answer(correct_text)
    compact_given = compact_answer(given_text)
    objective_type = any(word in qtype for word in ["单选", "多选", "选择", "判断", "客观"])
    short_objective = len(compact_correct) <= 20 and bool(re.fullmatch(r"[A-Z0-9]+", compact_correct))

    if "多" in qtype and re.fullmatch(r"[A-Z]+", compact_correct) and re.fullmatch(r"[A-Z]+", compact_given):
        return sorted(compact_correct) == sorted(compact_given)
    if objective_type or short_objective:
        return compact_correct == compact_given
    return False


def build_question_result(question: Question, given: str) -> dict[str, Any]:
    given = str(given).strip()
    correct = answer_matches(question.answer, given, question.qtype)
    return {
        "id": question.id,
        "correct": correct,
        "yourAnswer": given,
        "correctAnswer": question.answer,
    }


def question_type_group(qtype: str) -> str:
    compact = re.sub(r"\s+", "", qtype or "")
    if "判断" in compact:
        return "判断题"
    if "单选" in compact or ("单" in compact and "选" in compact):
        return "单选题"
    if "多选" in compact or ("多" in compact and "选" in compact):
        return "多选题"
    return "其他"


def balanced_random_sample(questions: list[Question], count: int) -> list[Question]:
    target_total = min(count, len(questions))
    buckets = {label: [] for label in QUESTION_TYPE_ORDER}
    extra: list[Question] = []

    for question in questions:
        group = question_type_group(question.qtype)
        if group in buckets:
            buckets[group].append(question)
        else:
            extra.append(question)

    for group_questions in buckets.values():
        random.shuffle(group_questions)
    random.shuffle(extra)

    base = target_total // len(QUESTION_TYPE_ORDER)
    remainder = target_total % len(QUESTION_TYPE_ORDER)
    selected: list[Question] = []
    selected_ids: set[str] = set()

    for index, label in enumerate(QUESTION_TYPE_ORDER):
        desired = base + (1 if index < remainder else 0)
        picks = buckets[label][:desired]
        selected.extend(picks)
        selected_ids.update(question.id for question in picks)

    if len(selected) < target_total:
        remaining = [
            question
            for label in QUESTION_TYPE_ORDER
            for question in buckets[label]
            if question.id not in selected_ids
        ]
        remaining.extend(question for question in extra if question.id not in selected_ids)
        random.shuffle(remaining)
        selected.extend(remaining[: target_total - len(selected)])

    random.shuffle(selected)
    return selected


def prune_old_exams() -> None:
    cutoff = time.time() - 60 * 60 * 8
    old_ids = [exam_id for exam_id, exam in EXAMS.items() if exam.get("created", 0) < cutoff]
    for exam_id in old_ids:
        EXAMS.pop(exam_id, None)


class ExamHandler(SimpleHTTPRequestHandler):
    server_version = "ExamSimulator/1.0"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format: str, *args: Any) -> None:
        sys.stdout.write("%s - %s\n" % (self.address_string(), format % args))

    def send_json(self, payload: dict[str, Any], status: int = 200) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def send_excel_download(self, raw: bytes, filename: str, fallback: str = "question-bank.xlsx") -> None:
        encoded_filename = quote(filename)
        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        self.send_header(
            "Content-Disposition",
            f"attachment; filename={fallback}; filename*=UTF-8''{encoded_filename}",
        )
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def read_json_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw or "{}")

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path == "/":
            self.path = "/templates/index.html"
            return super().do_GET()
        if path == "/api/subjects":
            try:
                bank = load_question_bank()
                self.send_json(question_bank_payload(bank))
            except WorkbookReadError as exc:
                self.send_json({"error": str(exc)}, status=400)
            return
        if path == "/api/search":
            query = parse_qs(parsed.query)
            keyword = query.get("q", [""])[0].strip()
            filename = query.get("bank", [""])[0].strip()
            try:
                limit = max(1, min(int(query.get("limit", ["80"])[0]), 200))
                bank_path = resolve_question_bank_path(filename)
                self.send_json(search_question_bank(bank_path, keyword, limit))
            except ValueError:
                self.send_json({"error": "搜索数量参数不正确。"}, status=400)
            except WorkbookReadError as exc:
                self.send_json({"error": str(exc)}, status=400)
            return
        if path == "/api/template":
            self.send_excel_download(build_question_bank_template(), TEMPLATE_FILENAME)
            return
        if path == "/api/preview":
            query = parse_qs(parsed.query)
            subject = query.get("subject", [""])[0]
            try:
                bank = load_question_bank()
                questions: list[Question] = bank["questions"]
                sample = [q.public() for q in questions if not subject or q.subject == subject][:5]
                self.send_json({"questions": sample})
            except WorkbookReadError as exc:
                self.send_json({"error": str(exc)}, status=400)
            return
        return super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        try:
            if path == "/api/exams":
                return self.create_exam()
            if path == "/api/upload":
                return self.upload_bank()
            if path == "/api/banks/select":
                return self.select_bank()
            if path == "/api/format":
                return self.format_question_list()
            match = re.fullmatch(r"/api/exams/([^/]+)/check", path)
            if match:
                return self.check_question(match.group(1))
            match = re.fullmatch(r"/api/exams/([^/]+)/submit", path)
            if match:
                return self.submit_exam(match.group(1))
            self.send_json({"error": "接口不存在。"}, status=404)
        except json.JSONDecodeError:
            self.send_json({"error": "请求 JSON 格式不正确。"}, status=400)
        except WorkbookReadError as exc:
            self.send_json({"error": str(exc)}, status=400)
        except UploadReadError as exc:
            self.send_json({"error": str(exc)}, status=400)
        except QuestionFormatError as exc:
            self.send_json({"error": str(exc)}, status=400)
        except Exception as exc:  # noqa: BLE001 - return readable local-server errors.
            self.send_json({"error": f"服务器处理失败：{exc}"}, status=500)

    def upload_bank(self) -> None:
        content_type = self.headers.get("Content-Type", "")
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0:
            self.send_json({"error": "请选择要上传的 Excel 文件。"}, status=400)
            return
        filename, file_data = parse_multipart_upload(self.rfile.read(length), content_type)

        DATA_DIR.mkdir(parents=True, exist_ok=True)
        temp_path = DATA_DIR / ".upload.tmp.xlsx"
        final_path = DATA_DIR / filename
        temp_path.write_bytes(file_data)
        try:
            load_question_bank(temp_path)
            if final_path.exists():
                final_path.unlink()
            shutil.move(str(temp_path), str(final_path))
            save_bank_meta(filename, filename)
            EXAMS.clear()
            bank = load_question_bank(final_path)
        finally:
            if temp_path.exists():
                temp_path.unlink()

        self.send_json(question_bank_payload(bank, "题库上传成功，已切换到新题库。"))

    def select_bank(self) -> None:
        body = self.read_json_body()
        path = resolve_question_bank_path(str(body.get("filename", "")))
        bank = load_question_bank(path)
        save_bank_meta(path.name, path.name)
        EXAMS.clear()
        bank = load_question_bank(path)
        self.send_json(question_bank_payload(bank, "题库切换成功。"))

    def format_question_list(self) -> None:
        content_type = self.headers.get("Content-Type", "")
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0:
            self.send_json({"error": "请选择要整理的 Word 或 Excel 文件。"}, status=400)
            return
        filename, file_data = parse_multipart_upload(
            self.rfile.read(length),
            content_type,
            allowed_exts=(".docx", ".xlsx"),
        )
        raw, question_count = format_uploaded_question_list(filename, file_data)
        output_name = f"{Path(filename).stem or '题库'}_整理后.xlsx"
        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        self.send_header(
            "Content-Disposition",
            f"attachment; filename=formatted-question-bank.xlsx; filename*=UTF-8''{quote(output_name)}",
        )
        self.send_header("X-Question-Count", str(question_count))
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def create_exam(self) -> None:
        prune_old_exams()
        body = self.read_json_body()
        raw_subjects = body.get("subjects", [])
        if isinstance(raw_subjects, str):
            selected_subjects = {raw_subjects}
        else:
            selected_subjects = {str(item) for item in raw_subjects}
        mode = body.get("mode", "random")
        shuffle_questions = bool(body.get("shuffle", True))
        count = int(body.get("count") or 0)

        bank = load_question_bank()
        questions: list[Question] = bank["questions"]
        if selected_subjects:
            questions = [question for question in questions if question.subject in selected_subjects]
        if not questions:
            self.send_json({"error": "没有可用题目，请检查题库或选择至少一个有题目的学科。"}, status=400)
            return

        if mode == "random":
            if count <= 0:
                self.send_json({"error": "随机出题数量必须大于 0。"}, status=400)
                return
            selected = balanced_random_sample(questions, min(count, RANDOM_EXAM_LIMIT))
        else:
            selected = list(questions)
            if shuffle_questions:
                random.shuffle(selected)

        exam_id = uuid.uuid4().hex
        EXAMS[exam_id] = {"created": time.time(), "questions": selected}
        self.send_json(
            {
                "examId": exam_id,
                "total": len(selected),
                "questions": [question.public() for question in selected],
            }
        )

    def check_question(self, exam_id: str) -> None:
        body = self.read_json_body()
        exam = EXAMS.get(exam_id)
        if not exam:
            self.send_json({"error": "考试记录不存在或已过期，请重新开始考试。"}, status=404)
            return

        question_id = str(body.get("questionId", ""))
        given = str(body.get("answer", "")).strip()
        questions: list[Question] = exam["questions"]
        question = next((item for item in questions if item.id == question_id), None)
        if not question:
            self.send_json({"error": "题目不存在，请重新开始考试。"}, status=404)
            return

        self.send_json(build_question_result(question, given))

    def submit_exam(self, exam_id: str) -> None:
        body = self.read_json_body()
        answers = body.get("answers", {})
        exam = EXAMS.get(exam_id)
        if not exam:
            self.send_json({"error": "考试记录不存在或已过期，请重新开始考试。"}, status=404)
            return

        questions: list[Question] = exam["questions"]
        results = []
        correct_count = 0
        for question in questions:
            given = str(answers.get(question.id, "")).strip()
            result = build_question_result(question, given)
            if result["correct"]:
                correct_count += 1
            results.append(result)

        self.send_json(
            {
                "total": len(questions),
                "correct": correct_count,
                "wrong": len(questions) - correct_count,
                "score": round(correct_count / len(questions) * 100, 1) if questions else 0,
                "results": results,
            }
        )


class ExclusiveThreadingHTTPServer(ThreadingHTTPServer):
    # Windows treats SO_REUSEADDR as permission for multiple listeners on the
    # same port, which can route requests to an outdated server process.
    allow_reuse_address = False


def bind_server(port: int) -> ThreadingHTTPServer:
    last_error: OSError | None = None
    for candidate in range(port, port + 20):
        try:
            return ExclusiveThreadingHTTPServer((HOST, candidate), ExamHandler)
        except OSError as exc:
            last_error = exc
    raise RuntimeError(f"无法绑定端口：{last_error}")


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    server = bind_server(port)
    actual_port = server.server_address[1]
    print("")
    print("题库模拟考试已启动")
    print(f"访问地址：http://{HOST}:{actual_port}")
    print(f"题库文件：{DATA_FILE}")
    print("按 Ctrl+C 停止服务")
    print("")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")


if __name__ == "__main__":
    main()
