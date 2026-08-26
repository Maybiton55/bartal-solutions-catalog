function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.QUOTE_RECIPIENT_EMAIL;

  if (!apiKey || !to) {
    return res.status(500).json({ error: 'email_not_configured' });
  }

  let body = req.body;

  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'invalid_json' });
    }
  }

  const {
    requestId,
    customer = {},
    products = [],
    pdfBase64 = ''
  } = body || {};

  const name = String(customer.name || '').trim().slice(0, 120);
  const company = String(customer.company || '').trim().slice(0, 160);
  const businessId = String(customer.id || '').trim().slice(0, 80);
  const phone = String(customer.phone || '').trim().slice(0, 80);
  const email = String(customer.email || '').trim().slice(0, 180);

  if (
    !name ||
    !businessId ||
    !email ||
    !pdfBase64 ||
    !Array.isArray(products) ||
    products.length < 1
  ) {
    return res.status(400).json({ error: 'missing_required_fields' });
  }

  if (pdfBase64.length > 4_000_000 || products.length > 100) {
    return res.status(413).json({ error: 'request_too_large' });
  }

  const rows = products.slice(0, 100).map((p, i) => {
    const title = escapeHtml(
      p.name || p.model || `פריט ${i + 1}`
    );

    const details = [
      p.manufacturer,
      p.model,
      p.category
    ]
      .filter(Boolean)
      .map(escapeHtml)
      .join(' · ');

    return `
      <tr>
        <td style="padding:9px;border-bottom:1px solid #e8eef1">
          ${i + 1}
        </td>
        <td style="padding:9px;border-bottom:1px solid #e8eef1">
          <strong>${title}</strong>
          ${
            details
              ? `<div style="color:#66727d;font-size:12px;margin-top:3px">
                  ${details}
                </div>`
              : ''
          }
        </td>
      </tr>
    `;
  }).join('');

  const subject =
    `בקשה חדשה להצעת מחיר - ${name}` +
    (company ? ` | ${company}` : '');

  const html = `
    <div dir="rtl"
      style="font-family:Arial,sans-serif;max-width:700px;margin:auto;color:#111">

      <h2 style="color:#0873a6">
        בקשה חדשה להצעת מחיר
      </h2>

      <p><strong>שם:</strong> ${escapeHtml(name)}</p>

      ${
        company
          ? `<p><strong>חברה:</strong> ${escapeHtml(company)}</p>`
          : ''
      }

      <p>
        <strong>ח.פ / ע.מ:</strong>
        ${escapeHtml(businessId)}
      </p>

      ${
        phone
          ? `<p><strong>טלפון:</strong> ${escapeHtml(phone)}</p>`
          : ''
      }

      <p>
        <strong>מייל:</strong>
        ${escapeHtml(email)}
      </p>

      <h3 style="margin-top:28px">
        מוצרים שנבחרו (${products.length})
      </h3>

      <table style="width:100%;border-collapse:collapse">
        <tbody>${rows}</tbody>
      </table>

      <p style="color:#66727d;margin-top:24px">
        קובץ PDF של הבקשה מצורף למייל.
      </p>
    </div>
  `;

  try {
    const response = await fetch(
      'https://api.resend.com/emails',
      {
        method: 'POST',

        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',

          ...(requestId
            ? {
                'Idempotency-Key':
                  String(requestId).slice(0, 200)
              }
            : {})
        },

        body: JSON.stringify({
          from: 'Bartal Solutions <onboarding@resend.dev>',
          to: [to],

          reply_to: email,

          subject,
          html,

          attachments: [
            {
              filename: 'quote-request.pdf',
              content: pdfBase64
            }
          ]
        })
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error('Resend error', response.status, data);

      return res.status(502).json({
        error: 'email_provider_error'
      });
    }

    return res.status(200).json({
      success: true,
      id: data.id || null
    });

  } catch (error) {
    console.error('Email send failed', error);

    return res.status(500).json({
      error: 'email_send_failed'
    });
  }
};
