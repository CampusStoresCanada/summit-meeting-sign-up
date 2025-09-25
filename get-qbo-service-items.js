// get-qbo-service-items.js - List existing service items in QuickBooks
const https = require('https');

const QBO_ACCESS_TOKEN = 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2IiwieC5vcmciOiJIMCJ9..teAfuNPAiyHSph2fdL6vGg.eNjggACRGs6_xgfwtnx5rMekgdsto6ous7YlB5P9dmNwc4zraUe_nBOTMVOg8oXKo-nceEsEWLPrAOo9XGkkoctl0WVXdEYSIXx3zX3Gs-WWCNcUyrXV3t0dVaO6crUD-KuTg0wjgUiMLH8sYuNWESPE7_3wLLBU_YblisY4587j1t16yFjTLJ-g1ewR0ppuRgVfAPz3wuEpRVW-1YRCy0pDvihahHJxppm1eJcCyQj-cYjxDaIBcXH20YNWUQIYICIJ-wSYV4WI1Q7ODktfdB7mh46HMRxV9VlQue9pUQv0CRA0RclYX44VHV5mlUL1fDVNNfnjgaF3cOZSB-Kfe7LOtrjjj1Bf6moBTLFsD7r8OwpbO1784kLlfpQGIFlqjI6EzIMB3mobU9CfsWcLcNc9DhNXK3IanKx4yY3Z83aaZUjRxzc7Skcxf1mSPukOMx3DS9ijxza7I8wHKOgZzVRCECyvbsjDoIplIy9J_Ls.Vb2nXCZ1aO4F_S-KqeL7YQ';
const QBO_COMPANY_ID = '9341455404363831';

console.log('📋 Getting existing service items from QuickBooks...');

const query = encodeURIComponent("SELECT * FROM Item WHERE Type='Service' MAXRESULTS 20");

const options = {
    hostname: 'sandbox-quickbooks.api.intuit.com',
    port: 443,
    path: `/v3/company/${QBO_COMPANY_ID}/query?query=${query}`,
    method: 'GET',
    headers: {
        'Authorization': `Bearer ${QBO_ACCESS_TOKEN}`,
        'Accept': 'application/json'
    }
};

const req = https.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        if (res.statusCode === 200) {
            const result = JSON.parse(data);

            if (result.QueryResponse && result.QueryResponse.Item) {
                console.log('\n✅ Found service items:');
                result.QueryResponse.Item.forEach(item => {
                    console.log(`- ${item.Name} (ID: ${item.Id})`);
                });

                console.log('\n💡 Use any of these IDs in your invoice creation code!');
                console.log('   Or create a new service item manually in the QBO interface.');
            } else {
                console.log('📝 No service items found. You need to create at least one manually.');
                console.log('   Go to QBO Settings → Products and Services → New → Service');
            }
        } else {
            console.error('❌ Query failed:', res.statusCode, res.statusMessage);
            console.error('Response:', data);
        }
    });
});

req.on('error', (error) => {
    console.error('❌ Request error:', error.message);
});

req.end();