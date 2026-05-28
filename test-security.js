require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');

const API_URL = process.env.API_URL || 'http://localhost:3000/send-message';
// Ubah menjadi Array untuk membaca semua nomor
const RECIPIENT_IDS = process.env.RECIPIENT_ID ? process.env.RECIPIENT_ID.split(',').map(id => id.trim()) : [];
const secretKey = process.env.API_KEY;

async function runTest() {
    console.log('=== MEMULAI UJI COBA KEAMANAN API ===');

    // ---------------------------------------------------------
    // SKENARIO 1: PENGIRIMAN NORMAL KE SEMUA NOMOR
    // ---------------------------------------------------------
    console.log('\n[SKENARIO 1] Request Valid & Aman (Multi-Recipient)');
    
    for (const id of RECIPIENT_IDS) {
        if (!id) continue;
        
        try {
            const msg1 = `🔔 Test 1: Pesan ini masuk ke WA ${id.split('@')[0]}`;
            const ts1 = Date.now().toString(); 
            const sig1 = crypto.createHmac('sha256', secretKey).update(id + msg1 + ts1).digest('hex');
            
            await axios.post(API_URL, { id: id, message: msg1, timestamp: ts1, signature: sig1 });
            console.log(`✅ HASIL: Sukses! Pesan berhasil masuk ke ${id}`);
        } catch (err) {
            console.error(`❌ HASIL: Gagal untuk ${id} -`, err.response?.data || err.message);
        }
    }

    // Ambil nomor pertama saja untuk Skenario 2 & 3 agar log tidak terlalu panjang
    const testId = RECIPIENT_IDS[0];

    if (testId) {
        // ---------------------------------------------------------
        // SKENARIO 2: UJI ENKRIPSI
        // ---------------------------------------------------------
        console.log('\n[SKENARIO 2] Hacker mengubah isi pesan (Harus Ditolak)');
        try {
            const msg2 = "Test 2: Pesan Asli";
            const ts2 = Date.now().toString();
            const sig2 = crypto.createHmac('sha256', secretKey).update(testId + msg2 + ts2).digest('hex');
            
            await axios.post(API_URL, { id: testId, message: "⚠️ Sistem di-hack!", timestamp: ts2, signature: sig2 });
        } catch (err) {
            console.log('✅ HASIL: Aman! Sistem Gateway menolak dengan alasan:', err.response?.data);
        }

        // ---------------------------------------------------------
        // SKENARIO 3: UJI SESSION
        // ---------------------------------------------------------
        console.log('\n[SKENARIO 3] Mengirim pesan dengan sesi > 1 Menit (Harus Ditolak)');
        try {
            const msg3 = "Test 3: Pesan Telat";
            const ts3 = (Date.now() - 120000).toString(); 
            const sig3 = crypto.createHmac('sha256', secretKey).update(testId + msg3 + ts3).digest('hex');
            
            await axios.post(API_URL, { id: testId, message: msg3, timestamp: ts3, signature: sig3 });
        } catch (err) {
            console.log('✅ HASIL: Aman! Sistem Gateway menolak dengan alasan:', err.response?.data);
        }
    }
}

runTest();