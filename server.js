const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Izinkan semua domain akses API ini
app.use(express.json());
app.use(express.static('.'));

// Health check
app.get('/', (req, res) => {
    res.send('🚢 Shipment Booms API is running!');
});

// ==========================================================
// ENDPOINT BERTHING (Backend mengambil data & parse HTML)
// ==========================================================
app.get('/api/berthing', async (req, res) => {
    try {
        console.log('📡 Backend mengambil data berthing...');
        
        const sources = [
            { url: 'https://www.jict.co.id/vessel-schedule', name: 'JICT' },
            { url: 'https://malt300.com/Layanan/jadwalKapal', name: 'MALT' },
            { url: 'https://www.npct1.co.id/vessel-schedule', name: 'NPCT1' },
            { url: 'https://www.tpkkoja.co.id/vessel-schedule/', name: 'TPK KOJA' }
        ];

        let allData = {};

        for (const source of sources) {
            try {
                console.log(`🔄 Fetching ${source.name}...`);
                
                const response = await fetch(source.url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'text/html'
                    },
                    timeout: 10000 // Timeout 10 detik
                });
                
                if (!response.ok) {
                    console.warn(`⚠️ ${source.name} HTTP ${response.status}`);
                    continue;
                }
                
                const html = await response.text();
                const parsed = parseBerthingHTML(html, source.name);
                
                // Gabungkan data
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
            } catch (error) {
                console.error(`❌ ${source.name} gagal:`, error.message);
            }
        }

        res.json({
            success: true,
            data: allData,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error di /api/berthing:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================================
// PARSER HTML (Backend)
// ==========================================================
function parseBerthingHTML(html, sourceName) {
    const result = {};
    try {
        const $ = cheerio.load(html);
        
        // Cari tabel yang berisi data kapal
        const tables = $('table');
        let targetTable = null;
        
        for (let i = 0; i < tables.length; i++) {
            const text = $(tables[i]).text().toLowerCase();
            if (text.includes('vessel') || text.includes('kapal') || text.includes('schedule')) {
                targetTable = tables[i];
                break;
            }
        }
        
        if (!targetTable) return result;
        
        const rows = $(targetTable).find('tr');
        if (rows.length < 2) return result;
        
        // Ambil header
        const headers = [];
        $(rows[0]).find('th, td').each((i, cell) => {
            headers.push($(cell).text().trim().toLowerCase());
        });
        
        // Cari indeks kolom
        let vesselIdx = -1, voyageIdx = -1, etaIdx = -1, ataIdx = -1, statusIdx = -1;
        
        for (let i = 0; i < headers.length; i++) {
            const h = headers[i];
            if (h.includes('vessel') || h.includes('kapal')) vesselIdx = i;
            if (h.includes('voyage')) voyageIdx = i;
            if (h.includes('eta')) etaIdx = i;
            if (h.includes('ata') || h.includes('berthing')) ataIdx = i;
            if (h.includes('status') || h.includes('keterangan')) statusIdx = i;
        }
        
        // Parse data
        for (let i = 1; i < rows.length; i++) {
            const cells = $(rows[i]).find('td');
            if (cells.length === 0) continue;
            
            let vesselName = $(cells[vesselIdx]).text().trim();
            if (!vesselName) continue;
            
            // Bersihkan nama kapal
            vesselName = vesselName.replace(/^MV\.\s*/i, '').trim().toUpperCase();
            
            const info = {
                source: sourceName,
                voyage: voyageIdx !== -1 ? $(cells[voyageIdx]).text().trim() : '',
                date: ataIdx !== -1 ? $(cells[ataIdx]).text().trim() : (etaIdx !== -1 ? $(cells[etaIdx]).text().trim() : ''),
                status: statusIdx !== -1 ? $(cells[statusIdx]).text().trim() : 'scheduled'
            };
            
            // Simpan data
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
        
    } catch (error) {
        console.error(`❌ Error parsing ${sourceName}:`, error.message);
    }
    
    return result;
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server berjalan di http://0.0.0.0:${PORT}`);
});
