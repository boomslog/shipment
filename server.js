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
                
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 15000); // Timeout 15 detik

                const response = await fetch(source.url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'text/html,application/xhtml+xml',
                        'Accept-Language': 'en-US,en;q=0.9'
                    },
                    signal: controller.signal
                });
                clearTimeout(timeout);
                
                if (!response.ok) {
                    console.warn(`⚠️ ${source.name} HTTP ${response.status} - Lewati`);
                    continue;
                }
                
                const html = await response.text();
                console.log(`✅ ${source.name} berhasil, panjang: ${html.length} bytes`);
                
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
                console.error(`❌ ${source.name} gagal (tidak mempengaruhi server):`, error.message);
            }
        }

        console.log(`📊 Total vessels berhasil diparse: ${Object.keys(allData).length}`);

        res.json({
            success: true,
            data: allData,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error fatal di /api/berthing:', error.message);
        // Pastikan server tidak crash, tetap kirim response kosong
        res.status(200).json({ 
            success: true, 
            data: {}, 
            timestamp: new Date().toISOString(),
            warning: 'Terjadi error saat parsing, data kosong'
        });
    }
});

// ==========================================
// PARSER HTML
// ==========================================
function parseBerthingHTML(html, sourceName) {
    const result = {};
    try {
        const $ = cheerio.load(html);
        
        // Cari tabel
        const tables = $('table');
        let targetTable = null;
        
        for (let i = 0; i < tables.length; i++) {
            const text = $(tables[i]).text().toLowerCase();
            if (text.includes('vessel') || text.includes('kapal') || text.includes('schedule') || 
                text.includes('voyage') || text.includes('etb')) {
                targetTable = tables[i];
                break;
            }
        }
        
        if (!targetTable) return result;
        
        const rows = $(targetTable).find('tr');
        if (rows.length < 2) return result;
        
        const headers = [];
        $(rows[0]).find('th, td').each((i, cell) => {
            headers.push($(cell).text().trim().toLowerCase());
        });
        
        let vesselIdx = -1, voyageIdx = -1, etaIdx = -1, ataIdx = -1, statusIdx = -1, etdIdx = -1;
        
        for (let i = 0; i < headers.length; i++) {
            const h = headers[i];
            if (h.includes('vessel') || h.includes('kapal') || h.includes('nama') || h.includes('mv')) vesselIdx = i;
            if (h.includes('voyage') || h.includes('voy')) voyageIdx = i;
            if (h.includes('eta') || h.includes('etb') || h.includes('arrival')) etaIdx = i;
            if (h.includes('ata') || h.includes('berthing') || h.includes('sand')) ataIdx = i;
            if (h.includes('status') || h.includes('keterangan') || h.includes('activity')) statusIdx = i;
            if (h.includes('etd') || h.includes('departure')) etdIdx = i;
        }
        
        if (vesselIdx === -1) {
            if (headers.length > 1 && headers[1].includes('name')) vesselIdx = 1;
            else if (headers.length > 0) vesselIdx = 0;
        }
        
        if (vesselIdx === -1) return result;
        
        for (let i = 1; i < rows.length; i++) {
            const cells = $(rows[i]).find('td');
            if (cells.length === 0 || cells.length <= vesselIdx) continue;
            
            let vesselName = $(cells[vesselIdx]).text().trim();
            if (!vesselName || vesselName === '-' || vesselName.length < 3) continue;
            
            vesselName = vesselName.replace(/^MV\.\s*/i, '').trim().toUpperCase();
            
            const rawVoyage = voyageIdx !== -1 && voyageIdx < cells.length ? $(cells[voyageIdx]).text().trim() : '';
            const rawEta = etaIdx !== -1 && etaIdx < cells.length ? $(cells[etaIdx]).text().trim() : '';
            const rawAta = ataIdx !== -1 && ataIdx < cells.length ? $(cells[ataIdx]).text().trim() : '';
            const rawStatus = statusIdx !== -1 && statusIdx < cells.length ? $(cells[statusIdx]).text().trim() : '';
            const rawEtd = etdIdx !== -1 && etdIdx < cells.length ? $(cells[etdIdx]).text().trim() : '';

            let berthingStatus = 'scheduled';
            let statusDisplay = rawStatus;
            
            if (rawStatus) {
                const s = rawStatus.toLowerCase();
                if (s.includes('sailing') || s.includes('berlayar')) berthingStatus = 'sailing';
                else if (s.includes('working') || s.includes('bongkar') || s.includes('loading')) berthingStatus = 'working';
                else if (s.includes('active') || s.includes('aktif')) berthingStatus = 'active';
                else if (s.includes('register') || s.includes('terdaftar')) berthingStatus = 'register';
                else if (s.includes('plan') || s.includes('rencana')) berthingStatus = 'scheduled';
                else if (s.includes('delay') || s.includes('tunda')) berthingStatus = 'delayed';
                else if (s.includes('complete') || s.includes('selesai')) berthingStatus = 'completed';
                else if (s.includes('sandar') || s.includes('berthed')) berthingStatus = 'berthing';
            }

            const extractDateTime = (str) => {
                if (!str) return { date: '', time: '' };
                let datePart = str;
                let timePart = '';
                const timeMatch = datePart.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
                if (timeMatch) {
                    timePart = timeMatch[1];
                    datePart = datePart.replace(/\s*\d{1,2}:\d{2}(?::\d{2})?\s*$/, '').trim();
                }
                return { date: datePart, time: timePart };
            };

            const mainDateRaw = rawAta || rawEta || '';
            const parsedDate = extractDateTime(mainDateRaw);
            const parsedAta = extractDateTime(rawAta);
            const parsedEta = extractDateTime(rawEta);
            const parsedEtd = extractDateTime(rawEtd);

            let voyageNumber = '';
            if (rawVoyage) {
                const match = rawVoyage.match(/(\d+)/);
                if (match) voyageNumber = match[1];
            }

            const info = {
                source: sourceName,
                voyage: voyageNumber,
                date: parsedDate.date,    
                time: parsedDate.time,    
                eta: rawEta,              
                ata: rawAta,              
                etd: rawEtd,              
                status: berthingStatus,   
                statusDisplay: statusDisplay 
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
        
    } catch (error) {
        console.error(`❌ Error parsing ${sourceName}:`, error.message);
    }
    
    return result;
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server berjalan di http://0.0.0.0:${PORT}`);
});
