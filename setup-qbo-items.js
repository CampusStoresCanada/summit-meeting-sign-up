// setup-qbo-items.js - Create required service items in QuickBooks sandbox
const https = require('https');

// These should match your Vercel environment variables
const QBO_ACCESS_TOKEN = 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2IiwieC5vcmciOiJIMCJ9..teAfuNPAiyHSph2fdL6vGg.eNjggACRGs6_xgfwtnx5rMekgdsto6ous7YlB5P9dmNwc4zraUe_nBOTMVOg8oXKo-nceEsEWLPrAOo9XGkkoctl0WVXdEYSIXx3zX3Gs-WWCNcUyrXV3t0dVaO6crUD-KuTg0wjgUiMLH8sYuNWESPE7_3wLLBU_YblisY4587j1t16yFjTLJ-g1ewR0ppuRgVfAPz3wuEpRVW-1YRCy0pDvihahHJxppm1eJcCyQj-cYjxDaIBcXH20YNWUQIYICIJ-wSYV4WI1Q7ODktfdB7mh46HMRxV9VlQue9pUQv0CRA0RclYX44VHV5mlUL1fDVNNfnjgaF3cOZSB-Kfe7LOtrjjj1Bf6moBTLFsD7r8OwpbO1784kLlfpQGIFlqjI6EzIMB3mobU9CfsWcLcNc9DhNXK3IanKx4yY3Z83aaZUjRxzc7Skcxf1mSPukOMx3DS9ijxza7I8wHKOgZzVRCECyvbsjDoIplIy9J_Ls.Vb2nXCZ1aO4F_S-KqeL7YQ'; // Update this!
const QBO_COMPANY_ID = '9341455404363831';
const QBO_BASE_URL = 'https://sandbox-quickbooks.api.intuit.com';

console.log('🛠️ Setting up QuickBooks service items...');

// Define the service items we need
const serviceItems = [
    {
        name: 'CSC Membership & Conference',
        description: 'Campus Stores Canada membership and conference registration bundle',
        unitPrice: 1000.00
    },
    {
        name: 'CSC Membership',
        description: 'Campus Stores Canada annual membership',
        unitPrice: 500.00
    },
    {
        name: 'Conference Registration',
        description: 'CSC Annual Conference registration',
        unitPrice: 325.00
    },
    {
        name: 'HST (13%)',
        description: 'Harmonized Sales Tax',
        unitPrice: 0.00
    }
];

async function createServiceItem(item) {
    return new Promise((resolve, reject) => {
        const itemData = {
            Name: item.name,
            Type: "Service",
            IncomeAccountRef: {
                value: "1" // Income account - will use default
            }
        };

        // Only add description if it exists
        if (item.description) {
            itemData.Description = item.description;
        }

        // Only add unit price if it's greater than 0
        if (item.unitPrice > 0) {
            itemData.UnitPrice = item.unitPrice;
        }

        const postData = JSON.stringify(itemData);

        const options = {
            hostname: 'sandbox-quickbooks.api.intuit.com',
            port: 443,
            path: `/v3/company/${QBO_COMPANY_ID}/item`,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${QBO_ACCESS_TOKEN}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Content-Length': postData.length
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
                    const createdItem = result.QueryResponse.Item[0];
                    console.log(`✅ Created: ${createdItem.Name} (ID: ${createdItem.Id})`);
                    resolve(createdItem);
                } else {
                    console.error(`❌ Failed to create ${item.name}:`, res.statusCode, res.statusMessage);
                    console.error('Response:', data);
                    console.error('Request payload:', JSON.stringify(JSON.parse(postData), null, 2));
                    reject(new Error(`Failed to create ${item.name}`));
                }
            });
        });

        req.on('error', (error) => {
            console.error(`❌ Request error for ${item.name}:`, error.message);
            reject(error);
        });

        req.write(postData);
        req.end();
    });
}

async function setupItems() {
    console.log('🚀 Creating service items in QuickBooks...\n');

    try {
        const createdItems = [];

        for (const item of serviceItems) {
            const createdItem = await createServiceItem(item);
            createdItems.push(createdItem);

            // Small delay between requests
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.log('\n🎉 All service items created successfully!');
        console.log('\n📋 Update your invoice creation code with these IDs:');

        createdItems.forEach((item, index) => {
            console.log(`- ${item.Name}: ID ${item.Id}`);
        });

        console.log('\n💡 You may need to update the ItemRef values in your create-qbo-invoice.js file');
        console.log('   to use these actual IDs instead of hardcoded values like "1", "2", etc.');

    } catch (error) {
        console.error('❌ Setup failed:', error.message);
    }
}

// Check if access token is set
if (QBO_ACCESS_TOKEN === 'YOUR_ACCESS_TOKEN_HERE') {
    console.log('❌ Please update the QBO_ACCESS_TOKEN in this script first!');
    console.log('   Copy it from your Vercel environment variables.');
    process.exit(1);
}

setupItems();