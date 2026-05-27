"""
Die Order Template Generator
Creates a die order form template and overlays it on an existing PDF.
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.lib.colors import black, white
from PyPDF2 import PdfReader, PdfWriter
import io
import os
import sys
import json
import argparse


def _truthy(v):
    if isinstance(v, bool):
        return v
    if v is None:
        return False
    s = str(v).strip().lower()
    return s in ("1", "true", "yes", "y", "x", "on", "checked")


def _build_overlay(page_width, page_height, template_y_offset=None, values=None):
    """
    Build a PDF overlay with the die order template table.

    If `values` is None, the template is drawn with '-' placeholders (blank form,
    legacy behaviour). If `values` is a dict, its entries are rendered into the
    cells using the keys documented in FIELD_KEYS below.
    """
    blank_mode = values is None
    v = values or {}

    def text_val(key):
        if blank_mode:
            return "-"
        raw = v.get(key, "")
        if raw is None:
            return ""
        return str(raw)

    def check_val(key):
        if blank_mode:
            return False
        return _truthy(v.get(key))

    packet = io.BytesIO()
    c = canvas.Canvas(packet, pagesize=(page_width, page_height))

    table_width = 55 * mm
    left_margin = 8 * mm
    table_x = left_margin

    row_h = 4 * mm
    header_h = 5 * mm
    note_h = 4 * mm
    finish_h = 5.5 * mm

    total_rows_height = (
        header_h
        + row_h
        + row_h
        + row_h
        + row_h
        + row_h
        + row_h
        + row_h
        + row_h
        + row_h
        + note_h
        + finish_h
    )

    if template_y_offset is not None:
        table_top = page_height - template_y_offset
    else:
        table_top = page_height - 10 * mm

    col1_x = table_x
    col2_x = table_x + 13 * mm
    col3_x = table_x + 28 * mm
    col4_x = table_x + 41 * mm

    font_name = "Helvetica"
    font_bold = "Helvetica-Bold"
    font_size = 4.5
    small_font = 3.8

    c.setLineWidth(0.4)
    c.setStrokeColor(black)

    def draw_cell_text(text, x, y, w, h, bold=False, centered=False, font_sz=None):
        fs = font_sz or font_size
        c.setFont(font_bold if bold else font_name, fs)
        text_y = y - h / 2 - fs * 0.35
        if centered:
            c.drawCentredString(x + w / 2, text_y, text)
        else:
            c.drawString(x + 2 * mm, text_y, text)

    def draw_check_mark(box_x, box_y, size):
        """Draw an X mark inside a checkbox of given size at (box_x, box_y)."""
        pad = size * 0.18
        c.setLineWidth(0.5)
        c.line(box_x + pad, box_y + pad, box_x + size - pad, box_y + size - pad)
        c.line(box_x + pad, box_y + size - pad, box_x + size - pad, box_y + pad)
        c.setLineWidth(0.4)

    # White background for the entire table
    c.setFillColor(white)
    c.rect(table_x, table_top - total_rows_height, table_width, total_rows_height, fill=1)
    c.setFillColor(black)

    y = table_top  # top of current row

    # === ROW 1: SUPPLIER / DATE ===
    h = header_h
    c.rect(table_x, y - h, table_width, h)
    c.line(col2_x, y, col2_x, y - h)
    c.line(col3_x, y, col3_x, y - h)
    c.line(col4_x, y, col4_x, y - h)
    draw_cell_text("SUPPLIER", col1_x, y, col2_x - col1_x, h, bold=True)
    draw_cell_text(text_val("SUPPLIER"), col2_x, y, col3_x - col2_x, h)
    draw_cell_text("DATE", col3_x, y, col4_x - col3_x, h, bold=True)
    draw_cell_text(text_val("DATE"), col4_x, y, table_x + table_width - col4_x, h)
    y -= h

    # === ROW 2: *EMAIL THE DESIGN BEFORE MANUFACTURING* ===
    h = row_h
    c.rect(table_x, y - h, table_width, h)
    draw_cell_text("*EMAIL THE DESIGN BEFORE MANUFACTURING*", table_x, y, table_width, h, bold=True, centered=True)
    y -= h

    # === ROW 3: DIE SIZE ===
    h = row_h
    c.rect(table_x, y - h, table_width, h)
    c.line(col2_x, y, col2_x, y - h)
    draw_cell_text("DIE SIZE", col1_x, y, col2_x - col1_x, h, bold=True)
    draw_cell_text(text_val("DIE_SIZE"), col2_x, y, table_x + table_width - col2_x, h)
    y -= h

    # === ROW 4: No OF CAV / PRESS ===
    h = row_h
    c.rect(table_x, y - h, table_width, h)
    c.line(col2_x, y, col2_x, y - h)
    c.line(col3_x, y, col3_x, y - h)
    c.line(col4_x, y, col4_x, y - h)
    draw_cell_text("No OF CAV", col1_x, y, col2_x - col1_x, h, bold=True)
    draw_cell_text(text_val("NO_OF_CAV"), col2_x, y, col3_x - col2_x, h)
    draw_cell_text("PRESS", col3_x, y, col4_x - col3_x, h, bold=True)
    draw_cell_text(text_val("PRESS"), col4_x, y, table_x + table_width - col4_x, h)
    y -= h

    # === ROW 5: SOLID / HOLLOW ===
    h = row_h
    c.rect(table_x, y - h, table_width, h)
    c.line(col2_x, y, col2_x, y - h)
    c.line(col3_x, y, col3_x, y - h)
    c.line(col4_x, y, col4_x, y - h)
    draw_cell_text("SOLID", col1_x, y, col2_x - col1_x, h, bold=True)
    draw_cell_text(text_val("SOLID"), col2_x, y, col3_x - col2_x, h)
    draw_cell_text("HOLLOW", col3_x, y, col4_x - col3_x, h, bold=True)
    draw_cell_text(text_val("HOLLOW"), col4_x, y, table_x + table_width - col4_x, h)
    y -= h

    # === ROW 6: BOLSTER No / INSERT No ===
    h = row_h
    c.rect(table_x, y - h, table_width, h)
    c.line(col2_x, y, col2_x, y - h)
    c.line(col3_x, y, col3_x, y - h)
    c.line(col4_x, y, col4_x, y - h)
    draw_cell_text("BOLSTER No,", col1_x, y, col2_x - col1_x, h, bold=True)
    draw_cell_text(text_val("BOLSTER_NO"), col2_x, y, col3_x - col2_x, h)
    draw_cell_text("INSERT No,", col3_x, y, col4_x - col3_x, h, bold=True)
    draw_cell_text(text_val("INSERT_NO"), col4_x, y, table_x + table_width - col4_x, h)
    y -= h

    # === ROW 7: SIZE / SIZE ===
    h = row_h
    c.rect(table_x, y - h, table_width, h)
    c.line(col2_x, y, col2_x, y - h)
    c.line(col3_x, y, col3_x, y - h)
    c.line(col4_x, y, col4_x, y - h)
    draw_cell_text("SIZE", col1_x, y, col2_x - col1_x, h, bold=True)
    draw_cell_text(text_val("BOLSTER_SIZE"), col2_x, y, col3_x - col2_x, h)
    draw_cell_text("SIZE", col3_x, y, col4_x - col3_x, h, bold=True)
    draw_cell_text(text_val("INSERT_SIZE"), col4_x, y, table_x + table_width - col4_x, h)
    y -= h

    mid_x = table_x + 33 * mm

    # === ROW 8: REQUESTED DELIVERY DATE ===
    h = row_h
    c.rect(table_x, y - h, table_width, h)
    c.line(mid_x, y, mid_x, y - h)
    draw_cell_text("REQUESTED DELIVERY DATE", table_x, y, mid_x - table_x, h, bold=True)
    draw_cell_text(text_val("DELIVERY_DATE"), mid_x, y, table_x + table_width - mid_x, h)
    y -= h

    # === ROW 9: 3D MODULE FOR SIMULATION ===
    h = row_h
    c.rect(table_x, y - h, table_width, h)
    c.line(mid_x, y, mid_x, y - h)
    draw_cell_text("3D MODULE FOR SIMULATION", table_x, y, mid_x - table_x, h, bold=True)
    draw_cell_text(text_val("THREE_D_MODULE"), mid_x, y, table_x + table_width - mid_x, h)
    y -= h

    # === ROW 10: MODE OF SHIPMENT ===
    h = row_h
    c.rect(table_x, y - h, table_width, h)
    c.line(mid_x, y, mid_x, y - h)
    draw_cell_text("MODE OF SHIPMENT", table_x, y, mid_x - table_x, h, bold=True)
    draw_cell_text(text_val("SHIPMENT"), mid_x, y, table_x + table_width - mid_x, h)
    y -= h

    # === ROW 11: NOTE: PROFILE WEIGHT... ===
    h = note_h
    c.rect(table_x, y - h, table_width, h)
    if blank_mode:
        note_text = "NOTE: PROFILE WEIGHT SHOULD START FROM ..........%"
    else:
        pct = text_val("PROFILE_WEIGHT_PCT")
        filler = pct if pct else "..........."
        note_text = f"NOTE: PROFILE WEIGHT SHOULD START FROM {filler}%"
    draw_cell_text(note_text, table_x, y, table_width, h, bold=True)
    y -= h

    # === ROW 12: FINISH (with checkboxes) ===
    h = finish_h
    c.rect(table_x, y - h, table_width, h)

    c.setFont(font_bold, font_size)
    text_y = y - h / 2 - font_size * 0.35
    cx = table_x + 1.5 * mm
    c.drawString(cx, text_y, "FINISH")
    cx += 9 * mm

    box_size = 2.2 * mm
    box_y = y - h / 2 - box_size / 2

    # Mill
    c.drawString(cx, text_y, "Mill")
    cx += 5 * mm
    c.rect(cx, box_y, box_size, box_size)
    if check_val("FINISH_MILL"):
        draw_check_mark(cx, box_y, box_size)
    cx += box_size + 3.5 * mm

    # Anodizing
    c.drawString(cx, text_y, "Anodizing")
    cx += 9 * mm
    c.rect(cx, box_y, box_size, box_size)
    if check_val("FINISH_ANODIZING"):
        draw_check_mark(cx, box_y, box_size)
    cx += box_size + 3.5 * mm

    # Powder coating
    c.setFont(font_bold, small_font)
    c.drawString(cx, text_y + 1.5, "Powder")
    c.drawString(cx, text_y - 2, "coating")
    cx += 7.5 * mm
    c.rect(cx, box_y, box_size, box_size)
    if check_val("FINISH_POWDER"):
        draw_check_mark(cx, box_y, box_size)

    c.save()
    packet.seek(0)
    return packet


def create_template_overlay(page_width, page_height, template_y_offset=None):
    """Blank template overlay with '-' placeholders (legacy behaviour)."""
    return _build_overlay(page_width, page_height, template_y_offset, values=None)


def create_filled_overlay(values, page_width, page_height, template_y_offset=None):
    """Template overlay filled with the provided field values.

    Accepted keys in `values`:
      SUPPLIER, DATE, DIE_SIZE, NO_OF_CAV, PRESS, SOLID, HOLLOW,
      BOLSTER_NO, INSERT_NO, BOLSTER_SIZE, INSERT_SIZE,
      DELIVERY_DATE, THREE_D_MODULE, SHIPMENT, PROFILE_WEIGHT_PCT,
      FINISH_MILL (bool), FINISH_ANODIZING (bool), FINISH_POWDER (bool)
    """
    return _build_overlay(page_width, page_height, template_y_offset, values=values or {})


def _merge_overlay_into_pdf(input_pdf_path, output_pdf_path, overlay_packet):
    reader = PdfReader(input_pdf_path)
    writer = PdfWriter()

    first_page = reader.pages[0]
    overlay_reader = PdfReader(overlay_packet)
    overlay_page = overlay_reader.pages[0]

    first_page.merge_page(overlay_page)
    writer.add_page(first_page)

    for i in range(1, len(reader.pages)):
        writer.add_page(reader.pages[i])

    with open(output_pdf_path, "wb") as f:
        writer.write(f)


def add_template_to_pdf(input_pdf_path, output_pdf_path, template_y_offset=None):
    """Add the blank die order template to the first page of the input PDF."""
    reader = PdfReader(input_pdf_path)
    first_page = reader.pages[0]
    page_width = float(first_page.mediabox.width)
    page_height = float(first_page.mediabox.height)

    overlay = create_template_overlay(page_width, page_height, template_y_offset)
    _merge_overlay_into_pdf(input_pdf_path, output_pdf_path, overlay)
    print(f"Output saved to: {output_pdf_path}")


def add_filled_template_to_pdf(input_pdf_path, output_pdf_path, values, template_y_offset=None):
    """Add the die order template (filled with `values`) to the first page of the input PDF.

    Used for the 'backup die ordering request' flow: the webapp posts the form
    values for a backup-die request, and this function stamps the resulting
    order form onto the user's profile drawing PDF.
    """
    reader = PdfReader(input_pdf_path)
    first_page = reader.pages[0]
    page_width = float(first_page.mediabox.width)
    page_height = float(first_page.mediabox.height)

    overlay = create_filled_overlay(values, page_width, page_height, template_y_offset)
    _merge_overlay_into_pdf(input_pdf_path, output_pdf_path, overlay)
    print(f"Output saved to: {output_pdf_path}")


def _load_values_arg(values_arg):
    """`values_arg` is either a JSON string or '@/path/to/file.json'."""
    if values_arg is None:
        return {}
    if values_arg.startswith("@"):
        with open(values_arg[1:], "r", encoding="utf-8") as f:
            return json.load(f)
    return json.loads(values_arg)


def _main():
    parser = argparse.ArgumentParser(description="Die order template generator")
    parser.add_argument("--mode", choices=["blank", "backup"], default="blank",
                        help="blank = empty template with '-'; backup = fill from --values")
    parser.add_argument("--input", help="Input PDF path")
    parser.add_argument("--output", help="Output PDF path")
    parser.add_argument("--values", help="JSON values (string) or @path/to/values.json (for --mode backup)")
    parser.add_argument("--y-offset", type=float, default=10.0, dest="y_offset",
                        help="Top margin of the template in mm (default: 10)")
    parser.add_argument("legacy_offset", nargs="?", type=float,
                        help="(legacy positional) y offset in mm")
    args = parser.parse_args()

    y_offset_mm = args.legacy_offset if args.legacy_offset is not None else args.y_offset
    y_offset = y_offset_mm * mm

    if args.input and args.output:
        if args.mode == "backup":
            values = _load_values_arg(args.values)
            add_filled_template_to_pdf(args.input, args.output, values, template_y_offset=y_offset)
        else:
            add_template_to_pdf(args.input, args.output, template_y_offset=y_offset)
        print("Done! Template added to first page.")
        return

    # Legacy fallback: hardcoded paths if no --input/--output supplied.
    input_file = r"C:\Users\vijeesh\Desktop\Claude code work space\005242-802- original.pdf"
    output_file = r"C:\Users\vijeesh\Desktop\Claude code work space\005242-802-die-order.pdf"
    add_template_to_pdf(input_file, output_file, template_y_offset=y_offset)
    print("Done! Template added to first page.")


if __name__ == "__main__":
    _main()
