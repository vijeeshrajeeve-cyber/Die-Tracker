// Extract text from all PDF files in the sample directory
const pdfParse = require('pdf-parse');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'New die ordering request-GEX-1-Fast track die -Batch -1');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.pdf'));

async function run() {
    // Just parse a few representative files (first 3, some from middle, last 2)
    const sample = [files[0], files[1], files[2], files[7], files[16], files[17], files[20]].filter(Boolean);
    
    for (const file of sample) {
        const filePath = path.join(dir, file);
        const buffer = fs.readFileSync(filePath);
        try {
            const data = await pdfParse(buffer);
            console.log(`\n${'='.repeat(80)}`);
            console.log(`FILE: ${file} (${data.numpages} pages)`);
            console.log(`${'='.repeat(80)}`);
            // Print first 3000 chars of text
            console.log(data.text.substring(0, 3000));
            console.log('--- END OF SAMPLE ---');
        } catch (err) {
            console.error(`ERROR parsing ${file}: ${err.message}`);
        }
    }
}

run().catch(console.error);
