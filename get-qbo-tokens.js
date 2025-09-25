// get-qbo-tokens.js - Exchange OAuth code for QuickBooks tokens
const https = require('https');
const querystring = require('querystring');

// UPDATE THESE VALUES:
const CLIENT_ID = 'ABWoCpkKnZdbcv80uSNODEo3uziXz0bIRzWKA9t2TjXckNtzWl';
const CLIENT_SECRET = 'Nc4v0cek4NJ1n38ayjNVuseEmR59u9uN3nv6P1RC';
const REDIRECT_URI = 'http://localhost:3000/oauth-callback';
const AUTH_CODE = 'XAB11758829362cHez7Bv6oUex1e7bUPtobPzI5ou6NOTR9h1Z'; // From your URL
const COMPANY_ID = '9341455404363831'; // From your URL (realmId)

console.log('🔄 Exchanging OAuth code for QuickBooks tokens...');

// Prepare the request data
const postData = querystring.stringify({
    grant_type: 'authorization_code',
    code: AUTH_CODE,
    redirect_uri: REDIRECT_URI
});

// Base64 encode the client credentials
const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

// Configure the request
const options = {
    hostname: 'oauth.platform.intuit.com',
    port: 443,
    path: '/oauth2/v1/tokens/bearer',
    method: 'POST',
    headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': postData.length
    }
};

// Make the request
const req = https.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        if (res.statusCode === 200) {
            const tokens = JSON.parse(data);

            console.log('\n✅ Success! Here are your QuickBooks credentials:\n');
            console.log('📋 Copy these to your Vercel environment variables:\n');

            console.log(`QBO_CLIENT_ID=${CLIENT_ID}`);
            console.log(`QBO_CLIENT_SECRET=${CLIENT_SECRET}`);
            console.log(`QBO_ACCESS_TOKEN=${tokens.access_token}`);
            console.log(`QBO_REFRESH_TOKEN=${tokens.refresh_token}`);
            console.log(`QBO_COMPANY_ID=${COMPANY_ID}`);
            console.log(`QBO_BASE_URL=https://sandbox-quickbooks.api.intuit.com`);

            console.log('\n📝 Token Details:');
            console.log(`- Access Token expires in: ${tokens.expires_in} seconds (${Math.floor(tokens.expires_in/3600)} hours)`);
            console.log(`- Refresh Token expires in: ${tokens.x_refresh_token_expires_in} seconds (${Math.floor(tokens.x_refresh_token_expires_in/86400)} days)`);
            console.log('\n🔒 Keep these tokens secure - don\'t commit them to git!');

        } else {
            console.error('❌ Error response:', res.statusCode, res.statusMessage);
            console.error('Response:', data);
        }
    });
});

req.on('error', (error) => {
    console.error('❌ Request error:', error.message);
});

// Send the request
req.write(postData);
req.end();

console.log('📡 Request sent to QuickBooks...');