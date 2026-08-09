const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Health check
app.get('/', (req, res) => {
    res.send('🚢 Shipment Booms API is running!');
});

// Endpoint API Berthing
app.get('/api/berthing', async (req, res) => {
    try {
        console.log('📡 Fetching berthing data from all sources...');
        
        // ============ LANGSUNG AKSES WEBSITE (TANPA CORS PROXY) ============
        const sources = [
            {
                url: 'https://www.jict.co.id/vessel-schedule',
                name: 'JICT'
            },
            {
                url: 'https://malt300.com/Layanan/jadwalKapal',
                name: 'MALT'
            },
            {
                url: 'https://www.npct1.co.id/vessel-schedule',
                name: 'NPCT1'
            },
            {
                url: 'https://www.tpkkoja.co.id/vessel-schedule/',
                name: 'TPK KOJA'
            }
        ];

        let allData = {};
        let successCount = 0;

        for (const source of sources) {
            try {
                console.log(`🔄 Fetching ${source.name} from: ${source.url}`);
                
                const response = await fetch(source.url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                    }
                });
                
                if (!response.ok) {
                    console.error(`❌ ${source.name} HTTP ${response.status}`);
                    continue;
                }
                
                const html = await response.text();
                console.log(`✅ ${source.name} berhasil, panjang: ${html.length} bytes`);
                
                const parsed = parseBerthingHTML(html, source.name);
                console.log(`📊 ${source.name} parsed: ${Object.keys(parsed).length} vessels`);
                
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
            } catch (error) {
                console.error(`❌ ${source.name} gagal:`, error.message);
            }
        }

        console.log(`📊 Total vessels: ${Object.keys(allData).length}`);
        
        res.json({
            success: true,
            data: allData,
            sources: successCount,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error di /api/berthing:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message
        });
    }
});

// ============ PARSER HTML ============
function parseBerthingHTML(html, sourceName) {
    const result = {};
    try {
        const $ = cheerio.load(html);
        
        // Cari semua tabel
        const tables = $('table');
        let targetTable = null;
        
        for (let i = 0; i < tables.length; i++) {
            const text = $(tables[i]).text().toLowerCase();
            if (text.includes('vessel') || text.includes('kapal') || text.includes('schedule') || 
                text.includes('voyage') || text.includes('jadwal')) {
                targetTable = tables[i];
                break;
            }
        }
        
        if (!targetTable) {
            console.warn(`⚠️ Tidak ditemukan tabel di ${sourceName}`);
            return result;
        }
        
        const rows = $(targetTable).find('tr');
        if (rows.length < 2) return result;
        
        // Ambil header
        const headers = [];
        $(rows[0]).find('th, td').each((i, cell) => {
            headers.push($(cell).text().trim().toLowerCase());
        });
        
        // Cari indeks kolom penting
        let vesselIdx = -1, voyageIdx = -1, etaIdx = -1, ataIdx = -1, statusIdx = -1, etdIdx = -1;
        
        for (let i = 0; i < headers.length; i++) {
            const h = headers[i];
            if (h.includes('vessel') || h.includes('kapal') || h.includes('nama')) vesselIdx = i;
            if (h.includes('voyage') || h.includes('voy')) voyageIdx = i;
            if (h.includes('eta') || h.includes('etb')) etaIdx = i;
            if (h.includes('ata') || h.includes('berthing') || h.includes('sand')) ataIdx = i;
            if (h.includes('status') || h.includes('keterangan')) statusIdx = i;
            if (h.includes('etd') || h.includes('departure')) etdIdx = i;
        }
        
        // Jika vesselIdx tidak ditemukan, coba cari manual
        if (vesselIdx === -1) {
            for (let i = 0; i < headers.length; i++) {
                const h = headers[i];
                if (h.includes('name') || h.includes('vessel')) {
                    vesselIdx = i;
                    break;
                }
            }
        }
        
        if (vesselIdx === -1) {
            console.warn(`⚠️ Tidak ditemukan kolom vessel di ${sourceName}`);
            return result;
        }
        
        // Parse data
        let parsedCount = 0;
        for (let i = 1; i < rows.length; i++) {
            const cells = $(rows[i]).find('td');
            if (cells.length === 0) continue;
            
            let vesselName = $(cells[vesselIdx]).text().trim();
            if (!vesselName || vesselName === '-' || vesselName === '') continue;
            
            // Bersihkan nama vessel
            vesselName = vesselName.replace(/^MV\.\s*/i, '').replace(/^\s*MV\s*/i, '').trim().toUpperCase();
            
            // Ambil data kolom
            const voyage = voyageIdx !== -1 && voyageIdx < cells.length ? $(cells[voyageIdx]).text().trim() : '';
            const eta = etaIdx !== -1 && etaIdx < cells.length ? $(cells[etaIdx]).text().trim() : '';
            const ata = ataIdx !== -1 && ataIdx < cells.length ? $(cells[ataIdx]).text().trim() : '';
            const status = statusIdx !== -1 && statusIdx < cells.length ? $(cells[statusIdx]).text().trim() : '';
            const etd = etdIdx !== -1 && etdIdx < cells.length ? $(cells[etdIdx]).text().trim() : '';
            
            // Tentukan status
            let berthingStatus = 'scheduled';
            if (status) {
                const s = status.toLowerCase();
                if (s.includes('sailing')) berthingStatus = 'sailing';
                else if (s.includes('working') || s.includes('bongkar')) berthingStatus = 'berthing';
                else if (s.includes('active')) berthingStatus = 'active';
                else if (s.includes('register')) berthingStatus = 'register';
                else if (s.includes('plan')) berthingStatus = 'scheduled';
                else if (s.includes('delay') || s.includes('tunda')) berthingStatus = 'delayed';
            }
            
            // Ekstrak tanggal dan jam
            let date = ata || eta || '';
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
                ata: ata,
                eta: eta,
                etd: etd
            };
            
            // Simpan ke result
            if (result[vesselName]) {
                if (Array.isArray(result[vesselName])) {
                    result[vesselName].push(info);
                } else {
                    result[vesselName] = [result[vesselName], info];
                }
            } else {
                result[vesselName] = [info];
            }
            parsedCount++;
        }
        
        console.log(`📊 ${sourceName}: ${parsedCount} vessels parsed`);
        
    } catch (error) {
        console.error(`❌ Error parsing ${sourceName}:`, error.message);
    }
    
    return result;
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server berjalan di http://0.0.0.0:${PORT}`);
});
