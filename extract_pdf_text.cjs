// Dump the extracted text of a few PDFs, for eyeballing what an import batch
// actually contains before writing a parser against it.
//
//   node extract_pdf_text.cjs [directory] [--limit N] [--chars N]
//
// Defaults to the sample batch below. That folder is not in the repo, so pass a
// directory when you have your own batch to look at.
const { PDFParse } = require('pdf-parse');
const fs = require('fs');
const path = require('path');

const DEFAULT_DIR = 'New die ordering request-GEX-1-Fast track die -Batch -1';

function numericArg(name, fallback) {
    const i = process.argv.indexOf(name);
    if (i === -1) return fallback;
    const n = Number(process.argv[i + 1]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function run() {
    const dirArg = process.argv.slice(2).find((a) => !a.startsWith('--') && Number.isNaN(Number(a)));
    const dir = path.resolve(dirArg || path.join(__dirname, DEFAULT_DIR));
    const limit = numericArg('--limit', 5);
    const chars = numericArg('--chars', 3000);

    if (!fs.existsSync(dir)) {
        console.error(`No such directory: ${dir}`);
        console.error('Pass the folder holding the PDFs, e.g. node extract_pdf_text.cjs "C:/batches/gex-1"');
        process.exitCode = 1;
        return;
    }

    const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf')).slice(0, limit);
    if (!files.length) {
        console.error(`No PDF files in ${dir}`);
        process.exitCode = 1;
        return;
    }

    for (const file of files) {
        try {
            // pdf-parse v2 is a class, not the v1 `pdfParse(buffer)` function, and
            // it reports the page count as `total` rather than `numpages`.
            const parser = new PDFParse({ data: fs.readFileSync(path.join(dir, file)) });
            const data = await parser.getText();
            console.log(`\n${'='.repeat(80)}`);
            console.log(`FILE: ${file} (${data.total} pages)`);
            console.log(`${'='.repeat(80)}`);
            console.log(data.text.substring(0, chars));
            console.log('--- END OF SAMPLE ---');
        } catch (err) {
            console.error(`ERROR parsing ${file}: ${err.message}`);
        }
    }
}

run().catch(console.error);
