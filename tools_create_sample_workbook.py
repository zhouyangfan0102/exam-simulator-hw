from __future__ import annotations

import zipfile
from pathlib import Path
from xml.sax.saxutils import escape


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "data" / "题库.xlsx"


SHEETS = {
    "语文": [
        ["题型", "答案", "问题"],
        ["单选题", "B", "下列词语中书写完全正确的一项是：\nA. 振耳欲聋\nB. 震耳欲聋\nC. 震耳欲笼\nD. 振耳欲笼"],
        ["判断题", "对", "《岳阳楼记》的作者是范仲淹。"],
        ["多选题", "AC", "下列属于唐代诗人的是：\nA. 李白\nB. 苏轼\nC. 杜甫\nD. 辛弃疾"],
    ],
    "数学": [
        ["题型", "答案", "问题"],
        ["单选题", "C", "若 2x + 3 = 7，则 x 等于：\nA. 1\nB. 1.5\nC. 2\nD. 3"],
        ["多选题", "AC", "下列属于偶数的是：\nA. 2\nB. 3\nC. 8\nD. 9"],
        ["判断题", "错", "所有质数都是奇数。"],
    ],
    "英语": [
        ["题型", "答案", "问题"],
        ["单选题", "A", "Choose the correct answer:\nI ____ a book yesterday.\nA. read\nB. reads\nC. reading\nD. to read"],
        ["多选题", "BD", "Choose the words that are verbs:\nA. beautiful\nB. run\nC. quickly\nD. write"],
        ["判断题", "对", "The word \"apple\" is a noun."],
    ],
}


def cell(column: str, row_index: int, value: str) -> str:
    safe = escape(value)
    return f'<c r="{column}{row_index}" t="inlineStr"><is><t>{safe}</t></is></c>'


def worksheet_xml(rows: list[list[str]]) -> str:
    row_xml = []
    for row_index, row in enumerate(rows, 1):
        cells = "".join(cell(column, row_index, value) for column, value in zip("ABC", row))
        row_xml.append(f'<row r="{row_index}">{cells}</row>')
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f"<sheetData>{''.join(row_xml)}</sheetData>"
        "</worksheet>"
    )


def build() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    sheet_names = list(SHEETS)

    workbook_sheets = []
    workbook_rels = []
    overrides = [
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    ]
    for index, name in enumerate(sheet_names, 1):
        workbook_sheets.append(f'<sheet name="{escape(name)}" sheetId="{index}" r:id="rId{index}"/>')
        workbook_rels.append(
            f'<Relationship Id="rId{index}" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
            f'Target="worksheets/sheet{index}.xml"/>'
        )
        overrides.append(
            f'<Override PartName="/xl/worksheets/sheet{index}.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        )

    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        f"{''.join(overrides)}"
        "</Types>"
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        "</Relationships>"
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f"<sheets>{''.join(workbook_sheets)}</sheets>"
        "</workbook>"
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f"{''.join(workbook_rels)}"
        "</Relationships>"
    )

    with zipfile.ZipFile(OUTPUT, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr("xl/workbook.xml", workbook)
        archive.writestr("xl/_rels/workbook.xml.rels", rels)
        for index, name in enumerate(sheet_names, 1):
            archive.writestr(f"xl/worksheets/sheet{index}.xml", worksheet_xml(SHEETS[name]))

    print(f"created {OUTPUT}")


if __name__ == "__main__":
    build()
