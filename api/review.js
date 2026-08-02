import { google } from 'googleapis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { reviewer_name, area, rating, review_text, date, source } = req.body;

  if (!reviewer_name || !rating || !review_text) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // 1. Save to Shopify Metaobject
    const shopifyRes = await fetch(
      `https://${process.env.SHOPIFY_STORE}/admin/api/2024-01/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': process.env.SHOPIFY_TOKEN,
        },
        body: JSON.stringify({
          query: `
            mutation {
              metaobjectCreate(metaobject: {
                type: "review",
                fields: [
                  { key: "reviewer_name", value: "${reviewer_name}" },
                  { key: "area", value: "${area || ''}" },
                  { key: "rating", value: "${rating}" },
                  { key: "review_text", value: "${review_text}" },
                  { key: "date", value: "${date || new Date().toISOString().split('T')[0]}" },
                  { key: "source", value: "${source || 'Direct'}" },
                  { key: "approved", value: "false" }
                ]
              }) {
                metaobject { id handle }
                userErrors { field message }
              }
            }
          `
        }),
      }
    );

    const shopifyData = await shopifyRes.json();
    const userErrors = shopifyData?.data?.metaobjectCreate?.userErrors;
    if (userErrors?.length > 0) {
      return res.status(400).json({ error: userErrors[0].message });
    }

    // 2. Save to Google Sheets
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!A:H',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[
          reviewer_name,
          area || '',
          rating,
          review_text,
          date || new Date().toISOString().split('T')[0],
          source || 'Direct',
          'Pending',
          new Date().toISOString()
        ]],
      },
    });

    return res.status(200).json({ success: true, message: 'Review submitted!' });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Something went wrong', details: error.message });
  }
}
