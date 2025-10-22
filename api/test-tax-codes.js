// api/test-tax-codes.js - Get tax codes from QuickBooks
export default async function handler(req, res) {
  const qboAccessToken = process.env.QBO_ACCESS_TOKEN;
  const qboCompanyId = process.env.QBO_COMPANY_ID;
  const qboBaseUrl = process.env.QBO_BASE_URL || 'https://quickbooks.api.intuit.com';

  if (!qboAccessToken || !qboCompanyId) {
    res.status(500).json({ error: 'Missing QB credentials' });
    return;
  }

  try {
    // Query for all tax codes
    const query = `SELECT * FROM TaxCode`;
    const url = `${qboBaseUrl}/v3/company/${qboCompanyId}/query?query=${encodeURIComponent(query)}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${qboAccessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Tax code query failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    res.status(200).json({
      success: true,
      taxCodes: data.QueryResponse?.TaxCode || []
    });

  } catch (error) {
    console.error('Error fetching tax codes:', error);
    res.status(500).json({
      error: error.message
    });
  }
}
