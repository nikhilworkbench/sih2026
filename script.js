// SkillTrack WhatsApp Cloud API gateway for SIH26135
// Node.js 18+
// Keep WhatsApp credentials on the server, never in the HTML.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 5000);

const VERIFY_TOKEN =
  process.env.WHATSAPP_VERIFY_TOKEN || '';

const ACCESS_TOKEN =
  process.env.WHATSAPP_ACCESS_TOKEN || '';

const PHONE_NUMBER_ID =
  process.env.WHATSAPP_PHONE_NUMBER_ID || '';

const GRAPH_VERSION =
  process.env.WHATSAPP_GRAPH_VERSION || 'v23.0';

const TEMPLATE_NAME =
  process.env.WHATSAPP_TEMPLATE_NAME ||
  'skilltrack_outcome_check';

const TEMPLATE_LANGUAGE =
  process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en';

const DATA_FILE = path.join(
  __dirname,
  'skilltrack_whatsapp_data.json'
);


// -----------------------------
// DATA STORAGE
// -----------------------------

function readData() {
  try {
    return JSON.parse(
      fs.readFileSync(DATA_FILE, 'utf8')
    );
  } catch {
    return {
      responses: [],
      messages: []
    };
  }
}


function writeData(data) {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(data, null, 2)
  );
}


// -----------------------------
// JSON RESPONSE
// -----------------------------

function json(res, status, body) {

  const text = JSON.stringify(body);

  res.writeHead(status, {
    'Content-Type': 'application/json',

    'Access-Control-Allow-Origin': '*',

    'Access-Control-Allow-Headers':
      'Content-Type',

    'Access-Control-Allow-Methods':
      'GET,POST,OPTIONS'
  });

  res.end(text);
}


// -----------------------------
// PHONE NUMBER VALIDATION
// -----------------------------

function cleanPhone(phone) {

  const p = String(phone || '')
    .replace(/\D/g, '');

  if (!/^91\d{10}$/.test(p)) {

    throw new Error(
      'Use an Indian mobile number with country code, e.g. 919876543210'
    );
  }

  return p;
}


// -----------------------------
// READ REQUEST BODY
// -----------------------------

async function readBody(req) {

  let body = '';

  for await (const chunk of req) {
    body += chunk;
  }

  return body
    ? JSON.parse(body)
    : {};
}


// -----------------------------
// SEND WHATSAPP TEMPLATE
// -----------------------------

async function sendWhatsAppTemplate(form) {

  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {

    throw new Error(
      'WhatsApp Cloud API credentials are not configured on the server.'
    );
  }

  const to = cleanPhone(form.phone);

  const url =
    `https://graph.facebook.com/` +
    `${GRAPH_VERSION}/` +
    `${PHONE_NUMBER_ID}/messages`;


  const payload = {

    messaging_product: 'whatsapp',

    to,

    type: 'template',

    template: {

      name: TEMPLATE_NAME,

      language: {
        code: TEMPLATE_LANGUAGE
      },

      components: [

        {
          type: 'body',

          parameters: [

            {
              type: 'text',
              text: String(form.name || '')
            },

            {
              type: 'text',
              text: String(form.course || '')
            },

            {
              type: 'text',
              text: String(form.sector || '')
            }

          ]
        }

      ]
    }
  };


  const apiRes = await fetch(
    url,
    {
      method: 'POST',

      headers: {
        Authorization:
          `Bearer ${ACCESS_TOKEN}`,

        'Content-Type':
          'application/json'
      },

      body: JSON.stringify(payload)
    }
  );


  const result =
    await apiRes.json()
      .catch(() => ({}));


  if (!apiRes.ok) {

    const detail =
      result?.error?.message ||
      `Meta Graph API returned HTTP ${apiRes.status}`;

    throw new Error(detail);
  }


  const messageId =
    result?.messages?.[0]?.id ||
    null;


  const data = readData();


  data.messages.unshift({

    id: messageId,

    to,

    form,

    sentAt:
      new Date().toISOString(),

    status:
      'accepted_by_api'

  });


  writeData(data);


  return messageId;
}


// -----------------------------
// HANDLE WHATSAPP WEBHOOK
// -----------------------------

function handleWebhookPayload(body) {

  const data = readData();

  const entries =
    Array.isArray(body?.entry)
      ? body.entry
      : [];


  for (const entry of entries) {

    for (const change of
      (entry.changes || [])) {

      const value =
        change.value || {};


      for (const msg of
        (value.messages || [])) {


        const text =
          msg?.text?.body ||
          msg?.button?.text ||
          msg?.interactive?.button_reply?.title ||
          '';


        const from =
          msg?.from || '';


        if (!text) {
          continue;
        }


        if (
          !data.responses.some(
            r => r.id === msg.id
          )
        ) {

          data.responses.unshift({

            id: msg.id,

            phone: from,

            text,

            timestamp:
              new Date().toLocaleTimeString(
                [],
                {
                  hour: '2-digit',
                  minute: '2-digit'
                }
              ),

            verified: false,

            source:
              'whatsapp_cloud_api'

          });
        }
      }
    }
  }


  writeData(data);
}


// -----------------------------
// HTTP SERVER
// -----------------------------

const server =
  http.createServer(
    async (req, res) => {

      if (req.method === 'OPTIONS') {

        return json(
          res,
          204,
          {}
        );
      }


      try {

        const url =
          new URL(
            req.url,
            `http://${req.headers.host}`
          );


        // -------------------------
        // META WEBHOOK VERIFICATION
        // -------------------------

        if (
          req.method === 'GET' &&
          url.pathname === '/webhook'
        ) {

          const mode =
            url.searchParams.get(
              'hub.mode'
            );

          const token =
            url.searchParams.get(
              'hub.verify_token'
            );

          const challenge =
            url.searchParams.get(
              'hub.challenge'
            );


          if (
            mode === 'subscribe' &&
            token &&
            token === VERIFY_TOKEN
          ) {

            res.writeHead(
              200,
              {
                'Content-Type':
                  'text/plain'
              }
            );

            return res.end(
              challenge || ''
            );
          }


          return json(
            res,
            403,
            {
              error:
                'Webhook verification failed'
            }
          );
        }


        // -------------------------
        // WHATSAPP WEBHOOK
        // -------------------------

        if (
          req.method === 'POST' &&
          url.pathname === '/webhook'
        ) {

          const body =
            await readBody(req);

          handleWebhookPayload(body);

          return json(
            res,
            200,
            {
              ok: true
            }
          );
        }


        // -------------------------
        // SEND SURVEY
        // -------------------------

        if (
          req.method === 'POST' &&
          url.pathname ===
            '/api/send-survey'
        ) {

          const form =
            await readBody(req);


          const messageId =
            await sendWhatsAppTemplate(
              form
            );


          return json(
            res,
            200,
            {
              ok: true,
              messageId
            }
          );
        }


        // -------------------------
        // GET RESPONSES
        // -------------------------

        if (
          req.method === 'GET' &&
          url.pathname ===
            '/api/responses'
        ) {

          return json(
            res,
            200,
            readData()
              .responses
              .slice(0, 100)
          );
        }


        // -------------------------
        // HEALTH CHECK
        // -------------------------

        if (
          req.method === 'GET' &&
          url.pathname ===
            '/api/health'
        ) {

          return json(
            res,
            200,
            {
              ok: true,

              whatsappConfigured:
                Boolean(
                  ACCESS_TOKEN &&
                  PHONE_NUMBER_ID
                ),

              template:
                TEMPLATE_NAME
            }
          );
        }


        // -------------------------
        // NOT FOUND
        // -------------------------

        return json(
          res,
          404,
          {
            error:
              'Not found'
          }
        );

      } catch (err) {

        console.error(err);


        return json(
          res,
          500,
          {
            error:
              err.message ||
              'Server error'
          }
        );
      }
    }
  );


// -----------------------------
// START SERVER
// -----------------------------

server.listen(
  PORT,
  () => {

    console.log(
      `SkillTrack WhatsApp gateway running on http://localhost:${PORT}`
    );

    console.log(
      `Webhook endpoint: http://localhost:${PORT}/webhook`
    );

    console.log(
      `Template: ${TEMPLATE_NAME} (${TEMPLATE_LANGUAGE})`
    );

  }
);
