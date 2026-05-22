require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');

const API_URL = process.env.API_URL || 'http://localhost:3000/send-message';
const RECIPIENT_ID = process.env.RECIPIENT_ID;
const secretKey = process.env.API_KEY;

async function runTest() {
    console.log('=== MEMULAI UJI COBA KEAMANAN API ===');

    // ---------------------------------------------------------
    // SKENARIO 1: PENGIRIMAN NORMAL (HARUS BERHASIL)
    // ---------------------------------------------------------
    console.log('\n[SKENARIO 1] Request Valid & Aman');
    try {
        const msg1 = "🔔 Test 1: Pesan ini sah dan aman serta terahkan.";
        const ts1 = Date.now().toString(); // Waktu saat ini
        const sig1 = crypto.createHmac('sha256', secretKey).update(RECIPIENT_ID + msg1 + ts1).digest('hex');
        
        await axios.post(API_URL, { id: RECIPIENT_ID, message: msg1, timestamp: ts1, signature: sig1 });
        console.log('✅ HASIL: Sukses! Pesan berhasil masuk ke WhatsApp.');
    } catch (err) {
        console.error('❌ HASIL: Gagal -', err.response?.data || err.message);
    }

    // ---------------------------------------------------------
    // SKENARIO 2: UJI ENKRIPSI (PESAN DIPALSUKAN TENGAH JALAN)
    // ---------------------------------------------------------
    console.log('\n[SKENARIO 2] Hacker mengubah isi pesan (Harus Ditolak)');
    try {
        const msg2 = "Test 2: Pesan Asli";
        const ts2 = Date.now().toString();
        // Enkripsi dibuat berdasarkan "Pesan Asli"
        const sig2 = crypto.createHmac('sha256', secretKey).update(RECIPIENT_ID + msg2 + ts2).digest('hex');
        
        // Data yang dikirim diubah menjadi pesan palsu
        await axios.post(API_URL, { id: RECIPIENT_ID, message: "⚠️ Sistem di-hack!", timestamp: ts2, signature: sig2 });
    } catch (err) {
        console.log('✅ HASIL: Aman! Sistem Gateway menolak dengan alasan:', err.response?.data);
    }

    // ---------------------------------------------------------
    // SKENARIO 3: UJI SESSION (SESI KEDALUWARSA)
    // ---------------------------------------------------------
    console.log('\n[SKENARIO 3] Mengirim pesan dengan sesi > 1 Menit (Harus Ditolak)');
    try {
        const msg3 = "Test 3: Pesan Telat";
        // Simulasi waktu dibuat mundur 2 menit yang lalu (120.000 ms)
        const ts3 = (Date.now() - 120000).toString(); 
        const sig3 = crypto.createHmac('sha256', secretKey).update(RECIPIENT_ID + msg3 + ts3).digest('hex');
        
        await axios.post(API_URL, { id: RECIPIENT_ID, message: msg3, timestamp: ts3, signature: sig3 });
    } catch (err) {
        console.log('✅ HASIL: Aman! Sistem Gateway menolak dengan alasan:', err.response?.data);
    }
}

runTest();