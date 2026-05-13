require('dotenv').config();
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const axios = require('axios');

// Environment variables
const IMAP_SERVER = process.env.IMAP_SERVER;
const IMAP_PORT = parseInt(process.env.IMAP_PORT) || 143;
const IMAP_USER = process.env.IMAP_USER;
const IMAP_PASSWORD = process.env.IMAP_PASSWORD;
const API_URL = process.env.API_URL;
const RECIPIENT_ID = process.env.RECIPIENT_ID;

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
  axios.post(API_URL, {
    message,
    id: RECIPIENT_ID
  }, {
    headers: {
      'x-api-key': process.env.API_KEY
    }
  }).then(() => {
    console.log('✅ Message sent to API');
  }).catch(err => {
    console.error('❌ Error sending to API:', err.message);
  });
}

function processNewEmail(stream, seqno) {
  simpleParser(stream)
    .then(parsed => {
      const emailSubject = parsed.subject || '';
      const emailText = parsed.text || '';
      const eventTime = extractTimeFromBody(emailText);
      const location = extractLocation(emailText);

      imap.addFlags(seqno, '\\Seen', () => {});

      if (!locationStatus[location]) {
        locationStatus[location] = {
          isPowerProblem: false,
          powerProblemTime: null,
          wasOnGenerator: false
        };
      }

      const status = locationStatus[location];
      const currentStatus = { ...status };

      const powerProblemTime = status.powerProblemTime;
      const timeDiff = powerProblemTime ? ((eventTime - powerProblemTime) / 1000).toFixed(2) : '-';

      console.log(`\n📧 New Email Received`);
      console.log(`Subject      : ${emailSubject}`);
      console.log(`Location     : ${location}`);
      console.log(`Event Time   : ${eventTime.toLocaleString()}`);
      console.log(`Prev Problem : ${powerProblemTime ? powerProblemTime.toLocaleString() : 'None'}`);
      console.log(`Time Diff    : ${timeDiff} seconds`);
      console.log(`Status       : isPowerProblem=${currentStatus.isPowerProblem}, wasOnGenerator=${currentStatus.wasOnGenerator}`);

      const subjectLower = emailSubject.toLowerCase();

      if (subjectLower.includes('ups:')) {
        if (subjectLower.includes('on battery power') && !status.isPowerProblem) {
          status.powerProblemTime = eventTime;
          status.isPowerProblem = true;
          console.log(`⚠️ Power problem started at ${location}`);
        } else if (subjectLower.includes('no longer on battery power') && status.isPowerProblem) {
          const diff = (eventTime - status.powerProblemTime) / 1000;
          let message;

          if (status.wasOnGenerator) {
            if (diff <= 5) {
              message = `✅ *Listrik PLN* di lokasi *${location}* sudah kembali *normal*.`;
              status.wasOnGenerator = false;
              console.log(`📩 Sending: ${message}`);
              sendEmailToApi(message);
            } else {
              console.log(`ℹ️ Diabaikan (wasOnGenerator=true & selisih ${diff.toFixed(2)}s > 5s)`);
            }
          } else {
            if (diff > 5) {
              message = `⚠️ *Listrik PLN* di lokasi *${location}* sedang *padam!*\n🔌 *Genset aktif* sebagai sumber daya sementara.`;
              status.wasOnGenerator = true;
            } else {
              message = `⚡ *Terjadi trip listrik* di lokasi *${location}*.`;
            }

            if (message) {
              console.log(`📩 Sending: ${message}`);
              sendEmailToApi(message);
            }
          }

          status.isPowerProblem = false;
          status.powerProblemTime = null;
        }
      } else if (!status.isPowerProblem) {
        console.log(`📩 Sending full email as-is (not a UPS alert)`);
        sendEmailToApi(emailText);
      }
    })
    .catch(err => {
      console.error('❌ Email parse error:', err);
    });
}

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
