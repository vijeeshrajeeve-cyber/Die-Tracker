// Field readers for the die order PDF import (PDFImportModal).

// Label words that land in a value slot when the column beside them is blank.
const LABEL_WORDS = /^(INSERT|BOLSTER|SIZE|SOLID|HOLLOW|NO|YES|OK|PRESS|DATE|SUPPLIER|REQUESTED|MODE|FINISH|CAV)$/i;

// The value after "<label> No". The separator is a run, not one character: the
// Sept 2026 forms print "INSERT No, - I-05138", and a single-character separator
// took the comma and left the dash as the value. The value must start with a
// letter or digit so a stray dash can never be read as a number.
const numberAfter = (lineText, label) => {
  const match = lineText.match(new RegExp(`${label}\\s*No\\.?[\\s\\-:.,]*([A-Za-z0-9][A-Za-z0-9-]*)`, 'i'));
  return match && !LABEL_WORDS.test(match[1]) ? match[1] : null;
};

// Bolster and insert numbers from the form's "BOLSTER No, - … INSERT No, - …" row.
export const extractBolsterInsertNos = (lineText) => ({
  bolsterNo: numberAfter(lineText, 'BOLSTER'),
  insertNo: numberAfter(lineText, 'INSERT'),
});

// A box is ticked by writing one of these after its label.
const MARK = /^(OK|YES|Y|✓|✔|√)$/i;

// Hollow or solid from the form's "SOLID - … HOLLOW - …" row, as pdf.js items
// ({ text, x }). A mark between the two labels ticks SOLID; one just after
// HOLLOW (within one label-gap) ticks HOLLOW. Position, not line order, decides,
// because the mark can land on a line of its own. No mark, or both, says nothing.
export const readDieType = (items) => {
  const at = (word) => (items || []).find((it) => String(it.text).trim().toUpperCase() === word);
  const solid = at('SOLID');
  const hollow = at('HOLLOW');
  if (!solid || !hollow || hollow.x <= solid.x) return null;
  const gap = hollow.x - solid.x;
  const marks = items.filter((it) => MARK.test(String(it.text).trim()));
  const solidMarked = marks.some((m) => m.x > solid.x && m.x < hollow.x);
  const hollowMarked = marks.some((m) => m.x > hollow.x && m.x < hollow.x + gap);
  if (solidMarked === hollowMarked) return null;
  return solidMarked ? 'SOLID' : 'HOLLOW';
};
