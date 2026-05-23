require('dotenv').config();
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const axios = require('axios');
const crypto = require('crypto');

// Environment variables
const IMAP_SERVER = process.env.IMAP_SERVER;
const IMAP_PORT = parseInt(process.env.IMAP_PORT) || 143;
const IMAP_USER = process.env.IMAP_USER;
const IMAP_PASSWORD = process.env.IMAP_PASSWORD;
const API_URL = process.env.API_URL;
const RECIPIENT_ID = process.env.RECIPIENT_ID;

// const imap = new Imap({
//   user: IMAP_USER,
//   password: IMAP_PASSWORD,
//   host: IMAP_SERVER,
//   port: IMAP_PORT,
//   tls: true, // WAJIB TRUE untuk port 993
//   tlsOptions: { 
//     rejectUnauthorized: false // Abaikan jika server kantor menggunakan sertifikat self-signed
//   },
//   autotls: 'always'
// });

const imap = new Imap({
  user: IMAP_USER,
  password: IMAP_PASSWORD,
  host: IMAP_SERVER,
  port: IMAP_PORT,
  tls: false,
  autotls: false
});

// Status per lokasi
const locationStatus = {};

function extractTimeFromBody(emailText) {
  const timeMatch = emailText.match(/Time\s*:\s*(\d{2}:\d{2}:\d{2})/i);
  if (timeMatch) {
    const [hours, minutes, seconds] = timeMatch[1].split(':').map(Number);
    const currentDate = new Date();
    return new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), hours, minutes, seconds);
  }
  return new Date();
}

function extractLocation(emailText) {
  const locMatch = emailText.match(/Location\s*:\s*(.+)/i);
  return locMatch ? locMatch[1].trim() : 'Unknown';
}

function sendEmailToApi(messageBody) {
  const message = `📢 *Notifikasi UPS*\n\n${messageBody}`;
  const secretKey = process.env.API_KEY;
  
  // Proteksi jika API_KEY lupa dimasukkan di .env
  if (!secretKey) {
    console.error('❌ API_KEY tidak ditemukan di .env!');
    return;
  }

  // 1. Buat Waktu Sesi
  const timestamp = Date.now().toString();

  // 2. Buat Signature (Enkripsi HMAC)
  const payload = RECIPIENT_ID + message + timestamp;
  const signature = crypto.createHmac('sha256', secretKey).update(payload).digest('hex');

  // 3. Kirim via Axios ke Gateway
  axios.post(API_URL, {
    id: RECIPIENT_ID,
    message: message,
    timestamp: timestamp,
    signature: signature
  }).then(() => {
    console.log('✅ Message sent to API securely');
  }).catch(err => {
    // Tangkap error spesifik dari Gateway
    console.error('❌ Error sending to API:', err.response ? err.response.data : err.message);
  });
}

// function sendEmailToApi(messageBody) {
//   const message = `📢 *Notifikasi UPS*\n\n${messageBody}`;
//   axios.post(API_URL, {
//     message,
//     id: RECIPIENT_ID
//   }, {
//     headers: {
//       'x-api-key': process.env.API_KEY
//     }
//   }).then(() => {
//     console.log('✅ Message sent to API');
//   }).catch(err => {
//     console.error('❌ Error sending to API:', err.message);
//   });
// }

function processNewEmail(stream, seqno) {
  simpleParser(stream)
    .then(parsed => {
      const emailSubject = parsed.subject || '';
      const emailText = parsed.text || '';
      const eventTime = extractTimeFromBody(emailText);
      const location = extractLocation(emailText);

      // Tandai email sudah dibaca
      imap.addFlags(seqno, '\\Seen', () => {});

      if (!locationStatus[location]) {
        locationStatus[location] = {
          isPowerProblem: false,
          powerProblemTime: null,
          wasOnGenerator: false
        };
      }

      const status = locationStatus[location];
      const subjectLower = emailSubject.toLowerCase();
      const bodyLower = emailText.toLowerCase();

      console.log(`\n📧 Email Baru Masuk!`);
      console.log(`Subjek : ${emailSubject}`);

      // Cek apakah ini event listrik dengan membaca Subjek ATAU Isi Body email
      const isPowerOff = subjectLower.includes('on battery power') || bodyLower.includes('on battery power');
      const isPowerOn = subjectLower.includes('no longer on battery power') || bodyLower.includes('no longer on battery power');

      if (isPowerOff && !isPowerOn) {
        // --- 1. EVENT LISTRIK MATI ---
        if (!status.isPowerProblem) {
          status.powerProblemTime = eventTime;
          status.isPowerProblem = true;
          console.log(`⚠️ Menahan email... Menunggu apakah ini trip atau pemadaman di ${location}`);
        }

      } else if (isPowerOn) {
        // --- 2. EVENT LISTRIK NYALA ---
        if (status.isPowerProblem) {
          const diff = (eventTime - status.powerProblemTime) / 1000;
          let message;

          if (status.wasOnGenerator) {
            if (diff <= 5) {
              message = `✅ *Listrik PLN* di lokasi *${location}* sudah kembali *normal*.`;
              status.wasOnGenerator = false;
              sendEmailToApi(message);
            }
          } else {
            if (diff > 5) {
              message = `⚠️ *Listrik PLN* di lokasi *${location}* sedang *padam!*\n🔌 *Genset aktif* sebagai sumber daya sementara.`;
              status.wasOnGenerator = true;
            } else {
              message = `⚡ *Terjadi trip listrik* di lokasi *${location}*.`;
            }
            if (message) sendEmailToApi(message);
          }

          status.isPowerProblem = false;
          status.powerProblemTime = null;
        } else {
          // Jika mendapat notif nyala tapi tidak ada rekor padam sebelumnya
          sendEmailToApi(emailText || emailSubject);
        }

      } else {
        // --- 3. SEMUA EVENT LAINNYA ---
        // (Login web, baterai bocor, suhu panas, tes koneksi, dll)
        console.log(`📩 Meneruskan notifikasi sistem/login langsung ke WA...`);
        // Kirim isi email. Jika isi kosong, kirim subjeknya
        const contentToSend = emailText.trim() ? emailText : emailSubject;
        sendEmailToApi(contentToSend);
      }
    })
    .catch(err => {
      console.error('❌ Email parse error:', err);
    });
}

// function processNewEmail(stream, seqno) {
//   simpleParser(stream)
//     .then(parsed => {
//       const emailSubject = parsed.subject || '';
//       const emailText = parsed.text || '';
//       const eventTime = extractTimeFromBody(emailText);
//       const location = extractLocation(emailText);

//       imap.addFlags(seqno, '\\Seen', () => {});

//       if (!locationStatus[location]) {
//         locationStatus[location] = {
//           isPowerProblem: false,
//           powerProblemTime: null,
//           wasOnGenerator: false
//         };
//       }

//       const status = locationStatus[location];
//       const currentStatus = { ...status };

//       const powerProblemTime = status.powerProblemTime;
//       const timeDiff = powerProblemTime ? ((eventTime - powerProblemTime) / 1000).toFixed(2) : '-';

//       console.log(`\n📧 New Email Received`);
//       console.log(`Subject      : ${emailSubject}`);
//       console.log(`Location     : ${location}`);
//       console.log(`Event Time   : ${eventTime.toLocaleString()}`);
//       console.log(`Prev Problem : ${powerProblemTime ? powerProblemTime.toLocaleString() : 'None'}`);
//       console.log(`Time Diff    : ${timeDiff} seconds`);
//       console.log(`Status       : isPowerProblem=${currentStatus.isPowerProblem}, wasOnGenerator=${currentStatus.wasOnGenerator}`);

//       const subjectLower = emailSubject.toLowerCase();

//       if (subjectLower.includes('ups:')) {
//         if (subjectLower.includes('on battery power') && !status.isPowerProblem) {
//           status.powerProblemTime = eventTime;
//           status.isPowerProblem = true;
//           console.log(`⚠️ Power problem started at ${location}`);
//         } else if (subjectLower.includes('no longer on battery power') && status.isPowerProblem) {
//           const diff = (eventTime - status.powerProblemTime) / 1000;
//           let message;

//           if (status.wasOnGenerator) {
//             if (diff <= 5) {
//               message = `✅ *Listrik PLN* di lokasi *${location}* sudah kembali *normal*.`;
//               status.wasOnGenerator = false;
//               console.log(`📩 Sending: ${message}`);
//               sendEmailToApi(message);
//             } else {
//               console.log(`ℹ️ Diabaikan (wasOnGenerator=true & selisih ${diff.toFixed(2)}s > 5s)`);
//             }
//           } else {
//             if (diff > 5) {
//               message = `⚠️ *Listrik PLN* di lokasi *${location}* sedang *padam!*\n🔌 *Genset aktif* sebagai sumber daya sementara.`;
//               status.wasOnGenerator = true;
//             } else {
//               message = `⚡ *Terjadi trip listrik* di lokasi *${location}*.`;
//             }

//             if (message) {
//               console.log(`📩 Sending: ${message}`);
//               sendEmailToApi(message);
//             }
//           }

//           status.isPowerProblem = false;
//           status.powerProblemTime = null;
//         }
//       } else if (!status.isPowerProblem) {
//         console.log(`📩 Sending full email as-is (not a UPS alert)`);
//         sendEmailToApi(emailText);
//       }
//     })
//     .catch(err => {
//       console.error('❌ Email parse error:', err);
//     });
// }

function startImapListener() {
  imap.once('ready', () => {
    imap.openBox('INBOX', false, (err) => {
      if (err) {
        console.error('❌ INBOX open error:', err);
        return;
      }
      console.log('📥 Listening for new emails...');

      imap.on('mail', () => {
        imap.search(['UNSEEN'], (err, results) => {
          if (err || !results || results.length === 0) return;

          const f = imap.fetch(results, { bodies: '' });
          f.on('message', (msg, seqno) => {
            msg.on('body', (stream) => {
              processNewEmail(stream, seqno);
            });
          });
        });
      });
    });
  });

  imap.once('error', (err) => {
    console.error('❌ IMAP error:', err.message);
    setTimeout(() => imap.connect(), 5000);
  });

  imap.once('end', () => {
    console.log('🔁 IMAP connection ended. Reconnecting...');
    setTimeout(() => imap.connect(), 5000);
  });

  imap.connect();
}

startImapListener();
