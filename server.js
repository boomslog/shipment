const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Endpoint untuk mengambil data berthing
app.get('/api/berthing', async (req, res) => {
    try {
        const sources = [
            {
                url: 'https://www.jict.co.id/vessel-schedule',
                name: 'JICT',
                parser: parseJICT
            },
            {
                url: 'https://malt300.com/Layanan/jadwalKapal',
                name: 'MALT',
                parser: parseMALT
            },
            {
                url: 'https://www.npct1.co.id/vessel-schedule',
                name: 'NPCT1',
                parser: parseNPCT1
            },
            {
                url: 'https://www.tpkkoja.co.id/vessel-schedule/',
                name: 'TPK KOJA',
                parser: parseTPKKOJA
            }
        ];

        let allData = {};
        let successCount = 0;

        for (const source of sources) {
            try {
                console.log(`Fetching ${source.name}...`);
                const response = await fetch(source.url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });
                
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const html = await response.text();
                
                const parsed = source.parser(html, source.name);
                for (const [vessel, info] of Object.entries(parsed)) {
                    if (allData[vessel]) {
                        if (Array.isArray(allData[vessel])) {
                            allData[vessel].push(info);
                        } else {
                            allData[vessel] = [allData[vessel], info];
                        }
                    } else {
                        allData[vessel] = [info];
                    }
                }
                successCount++;
                console.log(`✅ ${source.name} berhasil: ${Object.keys(parsed).length} vessel`);
            } catch (error) {
                console.error(`❌ ${source.name} gagal:`, error.message);
            }
        }

        res.json({
            success: true,
            data: allData,
            sources: successCount,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ PARSER UNTUK MASING-MASING SUMBER ============

function parseJICT(html, sourceName) {
    const result = {};
    const $ = cheerio.load(html);
    
    const tables = $('table');
    let targetTable = null;
    
    tables.each((i, table) => {
        const text = $(table).text().toLowerCase();
        if (text.includes('vessel') && text.includes('voyage')) {
            targetTable = table;
            return false;
        }
    });
    
    if (!targetTable) return result;
    
    const rows = $(targetTable).find('tr');
    if (rows.length < 2) return result;
    
    const headers = [];
    $(rows[0]).find('th, td').each((i, cell) => {
        headers.push($(cell).text().trim().toLowerCase());
    });
    
    let vesselIdx = -1, voyageIdx = -1, arrivalIdx = -1, berthingIdx = -1, statusIdx = -1;
    
    headers.forEach((h, i) => {
        if (h.includes('vessel')) vesselIdx = i;
        if (h.includes('voyage')) voyageIdx = i;
        if (h.includes('arrival')) arrivalIdx = i;
        if (h.includes('berthing')) berthingIdx = i;
        if (h.includes('status')) statusIdx = i;
    });
    
    if (vesselIdx === -1) return result;
    
    for (let i = 1; i < rows.length; i++) {
        const cells = $(rows[i]).find('td');
        if (cells.length === 0) continue;
        
        let vesselName = $(cells[vesselIdx]).text().trim();
        if (!vesselName) continue;
        
        vesselName = vesselName.toUpperCase().trim();
        
        const voyage = voyageIdx !== -1 ? $(cells[voyageIdx]).text().trim() : '';
        const arrival = arrivalIdx !== -1 ? $(cells[arrivalIdx]).text().trim() : '';
        const berthing = berthingIdx !== -1 ? $(cells[berthingIdx]).text().trim() : '';
        const status = statusIdx !== -1 ? $(cells[statusIdx]).text().trim() : '';
        
        let berthingStatus = 'scheduled';
        if (status) {
            const s = status.toLowerCase();
            if (s.includes('sailing')) berthingStatus = 'sailing';
            else if (s.includes('working')) berthingStatus = 'berthing';
            else if (s.includes('plan')) berthingStatus = 'scheduled';
        }
        
        let date = berthing || arrival || '';
        let time = '';
        const timeMatch = date.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
        if (timeMatch) {
            time = timeMatch[1];
            date = date.replace(/\s*\d{1,2}:\d{2}(?::\d{2})?\s*$/, '').trim();
        }
        
        const info = {
            source: sourceName,
            voyage: voyage,
            date: date,
            time: time,
            status: berthingStatus,
            statusDisplay: status,
            ata: berthing,
            eta: arrival
        };
        
        if (result[vesselName]) {
            if (Array.isArray(result[vesselName])) {
                result[vesselName].push(info);
            } else {
                result[vesselName] = [result[vesselName], info];
            }
        } else {
            result[vesselName] = [info];
        }
    }
    
    return result;
}

function parseMALT(html, sourceName) {
    const result = {};
    const $ = cheerio.load(html);
    
    const tables = $('table');
    let targetTable = null;
    
    tables.each((i, table) => {
        const text = $(table).text().toLowerCase();
        if (text.includes('mv.') && text.includes('voy')) {
            targetTable = table;
            return false;
        }
    });
    
    if (!targetTable) return result;
    
    const rows = $(targetTable).find('tr');
    if (rows.length < 2) return result;
    
    for (let i = 1; i < rows.length; i++) {
        const cells = $(rows[i]).find('td');
        if (cells.length < 5) continue;
        
        let vesselName = $(cells[1]).text().trim();
        if (!vesselName) continue;
        
        vesselName = vesselName.replace(/^MV\.\s*/i, '').trim().toUpperCase();
        
        const voyageS = $(cells[3]).text().trim();
        const voyageN = $(cells[4]).text().trim();
        const etb = $(cells[5]).text().trim();
        const ata = $(cells[6]).text().trim();
        const etd = $(cells[7]).text().trim();
        
        let date = ata || etb || '';
        let time = '';
        const timeMatch = date.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
        if (timeMatch) {
            time = timeMatch[1];
            date = date.replace(/\s*\d{1,2}:\d{2}(?::\d{2})?\s*$/, '').trim();
        }
        
        const info = {
            source: sourceName,
            voyage: voyageN || voyageS,
            date: date,
            time: time,
            status: 'scheduled',
            statusDisplay: '',
            ata: ata,
            eta: etb,
            etd: etd
        };
        
        if (result[vesselName]) {
            if (Array.isArray(result[vesselName])) {
                result[vesselName].push(info);
            } else {
                result[vesselName] = [result[vesselName], info];
            }
        } else {
            result[vesselName] = [info];
        }
    }
    
    return result;
}

function parseNPCT1(html, sourceName) {
    const result = {};
    const $ = cheerio.load(html);
    
    const tables = $('table');
    let targetTable = null;
    
    tables.each((i, table) => {
        const text = $(table).text().toLowerCase();
        if (text.includes('vessel') && text.includes('etb')) {
            targetTable = table;
            return false;
        }
    });
    
    if (!targetTable) return result;
    
    const rows = $(targetTable).find('tr');
    if (rows.length < 2) return result;
    
    const headers = [];
    $(rows[0]).find('th, td').each((i, cell) => {
        headers.push($(cell).text().trim().toLowerCase());
    });
    
    let vesselIdx = -1, statusIdx = -1, etbIdx = -1, ataIdx = -1, etdIdx = -1;
    
    headers.forEach((h, i) => {
        if (h === 'vessel') vesselIdx = i;
        if (h === 'status') statusIdx = i;
        if (h === 'etb') etbIdx = i;
        if (h === 'ata') ataIdx = i;
        if (h === 'etd') etdIdx = i;
    });
    
    if (vesselIdx === -1) return result;
    
    for (let i = 1; i < rows.length; i++) {
        const cells = $(rows[i]).find('td');
        if (cells.length === 0) continue;
        
        let vesselName = $(cells[vesselIdx]).text().trim();
        if (!vesselName) continue;
        
        vesselName = vesselName.toUpperCase().trim();
        
        const status = statusIdx !== -1 ? $(cells[statusIdx]).text().trim() : '';
        const etb = etbIdx !== -1 ? $(cells[etbIdx]).text().trim() : '';
        const ata = ataIdx !== -1 ? $(cells[ataIdx]).text().trim() : '';
        const etd = etdIdx !== -1 ? $(cells[etdIdx]).text().trim() : '';
        
        let berthingStatus = 'scheduled';
        if (status) {
            const s = status.toLowerCase();
            if (s.includes('active')) berthingStatus = 'active';
            else if (s.includes('register')) berthingStatus = 'register';
        }
        
        let date = ata || etb || '';
        let time = '';
        const timeMatch = date.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
        if (timeMatch) {
            time = timeMatch[1];
            date = date.replace(/\s*\d{1,2}:\d{2}(?::\d{2})?\s*$/, '').trim();
        }
        
        const info = {
            source: sourceName,
            voyage: '',
            date: date,
            time: time,
            status: berthingStatus,
            statusDisplay: status,
            ata: ata,
            eta: etb,
            etd: etd
        };
        
        if (result[vesselName]) {
            if (Array.isArray(result[vesselName])) {
                result[vesselName].push(info);
            } else {
                result[vesselName] = [result[vesselName], info];
            }
        } else {
            result[vesselName] = [info];
        }
    }
    
    return result;
}

function parseTPKKOJA(html, sourceName) {
    const result = {};
    const $ = cheerio.load(html);
    
    const tables = $('table');
    let targetTable = null;
    
    tables.each((i, table) => {
        const text = $(table).text().toLowerCase();
        if (text.includes('vessel') && text.includes('eta')) {
            targetTable = table;
            return false;
        }
    });
    
    if (!targetTable) return result;
    
    const rows = $(targetTable).find('tr');
    if (rows.length < 2) return result;
    
    const headers = [];
    $(rows[0]).find('th, td').each((i, cell) => {
        headers.push($(cell).text().trim().toLowerCase());
    });
    
    let vesselIdx = -1, etaIdx = -1, etdIdx = -1, berthingIdx = -1;
    
    headers.forEach((h, i) => {
        if (h === 'vessel name') vesselIdx = i;
        if (h === 'eta') etaIdx = i;
        if (h === 'etd') etdIdx = i;
        if (h.includes('berthing')) berthingIdx = i;
    });
    
    if (vesselIdx === -1) return result;
    
    for (let i = 1; i < rows.length; i++) {
        const cells = $(rows[i]).find('td');
        if (cells.length === 0) continue;
        
        let vesselName = $(cells[vesselIdx]).text().trim();
        if (!vesselName) continue;
        
        vesselName = vesselName.toUpperCase().trim();
        
        const eta = etaIdx !== -1 ? $(cells[etaIdx]).text().trim() : '';
        const etd = etdIdx !== -1 ? $(cells[etdIdx]).text().trim() : '';
        const berthing = berthingIdx !== -1 ? $(cells[berthingIdx]).text().trim() : '';
        
        let date = berthing || eta || '';
        let time = '';
        const timeMatch = date.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
        if (timeMatch) {
            time = timeMatch[1];
            date = date.replace(/\s*\d{1,2}:\d{2}(?::\d{2})?\s*$/, '').trim();
        }
        
        const info = {
            source: sourceName,
            voyage: '',
            date: date,
            time: time,
            status: 'scheduled',
            statusDisplay: '',
            ata: berthing,
            eta: eta,
            etd: etd
        };
        
        if (result[vesselName]) {
            if (Array.isArray(result[vesselName])) {
                result[vesselName].push(info);
            } else {
                result[vesselName] = [result[vesselName], info];
            }
        } else {
            result[vesselName] = [info];
        }
    }
    
    return result;
}

app.listen(PORT, () => {
    console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
});
