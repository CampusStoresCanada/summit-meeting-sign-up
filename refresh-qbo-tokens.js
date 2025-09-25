// refresh-qbo-tokens.js - Refresh expired QuickBooks tokens
const https = require('https');
const querystring = require('querystring');

// UPDATE THESE VALUES FROM YOUR VERCEL ENVIRONMENT VARIABLES:
const CLIENT_ID = 'ABWoCpkKnZdbcv80uSNODEo3uziXz0bIRzWKA9t2TjXckNtzWl';
const CLIENT_SECRET = 'Nc4v0cek4NJ1n38ayjNVuseEmR59u9uN3nv6P1RC';
const REFRESH_TOKEN = 'RT1-119-H0-1767555603q1okesvfvsdqj3corj4o'; // Get this from Vercel env vars

console.log('🔄 Refreshing QuickBooks access tokens...');

// Prepare the request data
const postData = querystring.stringify({
    grant_type: 'refresh_token',
    refresh_token: REFRESH_TOKEN
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

            console.log('\n✅ Tokens refreshed successfully! Here are your NEW credentials:\n');
            console.log('📋 Update these in your Vercel environment variables:\n');

            console.log(`QBO_ACCESS_TOKEN=${tokens.access_token}`);
            console.log(`QBO_REFRESH_TOKEN=${tokens.refresh_token}`);

            // Keep the same values for these:
            console.log(`QBO_CLIENT_ID=${CLIENT_ID}`);
            console.log(`QBO_CLIENT_SECRET=${CLIENT_SECRET}`);
            console.log(`QBO_COMPANY_ID=9341455404363831`);
            console.log(`QBO_BASE_URL=https://sandbox-quickbooks.api.intuit.com`);

            console.log('\n📝 Token Details:');
            console.log(`- New Access Token expires in: ${tokens.expires_in} seconds (${Math.floor(tokens.expires_in/3600)} hours)`);
            if (tokens.x_refresh_token_expires_in) {
                console.log(`- Refresh Token expires in: ${tokens.x_refresh_token_expires_in} seconds (${Math.floor(tokens.x_refresh_token_expires_in/86400)} days)`);
            }
            console.log('\n🔒 Update Vercel environment variables with the new tokens!');

        } else {
            console.error('❌ Token refresh failed:', res.statusCode, res.statusMessage);
            console.error('Response:', data);

            if (res.statusCode === 400) {
                console.log('\n💡 If refresh token is expired, you need to go through OAuth flow again:');
                console.log('   1. Run the qbo-oauth-helper.html page');
                console.log('   2. Or run get-qbo-tokens.js with a new authorization code');
            }
        }
    });
});

req.on('error', (error) => {
    console.error('❌ Request error:', error.message);
});

// Send the request
req.write(postData);
req.end();

console.log('📡 Token refresh request sent to QuickBooks...');