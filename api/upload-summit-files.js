export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    // Import AWS SDK dynamically
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');

    const { files, organizationName, token } = req.body;

    console.log('🔍 Summit file upload - Organization:', organizationName);
    console.log('🔍 Summit file upload - Files:', files?.length);
    console.log('🔍 Summit file upload - Token:', token);

    if (!files || !Array.isArray(files) || files.length === 0) {
      console.log('❌ No files provided');
      res.status(400).json({ error: 'No files provided' });
      return;
    }

    if (!organizationName && !token) {
      console.log('❌ No organization identifier provided');
      res.status(400).json({ error: 'Organization name or token required' });
      return;
    }

    // Initialize S3 client
    console.log('🔍 AWS Config:', {
      region: process.env.AWS_REGION,
      bucket: process.env.AWS_S3_BUCKET,
      hasAccessKey: !!process.env.AWS_ACCESS_KEY_ID,
      hasSecretKey: !!process.env.AWS_SECRET_ACCESS_KEY
    });

    const s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });

    const uploadedUrls = {
      tlpRedAgreement: null,
      employmentAgreement: null,
      virtualProtocol: null,
      certification: null
    };

    // Use organization name if available, otherwise use token as folder name
    const folderName = organizationName
      ? organizationName.replace(/[^a-zA-Z0-9 ]/g, '-').replace(/\s+/g, '-')
      : token?.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 50) || 'unknown';

    const basePath = `summit/${folderName}/`;

    // Upload each file to S3
    for (const fileData of files) {
      try {
        console.log(`⬆️ Uploading summit file: ${fileData.name} (${fileData.fieldName})`);

        const fileName = fileData.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const timestamp = Date.now();

        // Determine folder and field name
        let subFolder = '';
        let urlField = null;

        if (fileData.fieldName === 'tlpRedAgreement') {
          subFolder = 'tlp-red-agreements/';
          urlField = 'tlpRedAgreement';
        } else if (fileData.fieldName === 'employmentAgreement') {
          subFolder = 'employment-agreements/';
          urlField = 'employmentAgreement';
        } else if (fileData.fieldName === 'virtualProtocol') {
          subFolder = 'virtual-protocols/';
          urlField = 'virtualProtocol';
        } else if (fileData.fieldName === 'certification') {
          subFolder = 'certifications/';
          urlField = 'certification';
        }

        const s3Key = `${basePath}${subFolder}${timestamp}_${fileName}`;

        console.log('🔍 S3 key:', s3Key);

        // Convert base64 to buffer
        const fileBuffer = Buffer.from(fileData.content, 'base64');

        // Upload to S3
        const command = new PutObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET,
          Key: s3Key,
          Body: fileBuffer,
          ContentType: fileData.type || 'application/octet-stream'
        });

        await s3Client.send(command);

        // Create public URL
        const fileUrl = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;

        if (urlField) {
          uploadedUrls[urlField] = fileUrl;
          console.log(`✅ ${urlField} uploaded: ${fileUrl}`);
        }

      } catch (fileError) {
        console.error(`💥 Error uploading ${fileData.name}:`, fileError);
        throw fileError;
      }
    }

    console.log('🎉 Summit file upload complete!', uploadedUrls);

    res.status(200).json({
      success: true,
      urls: uploadedUrls
    });

  } catch (error) {
    console.error('💥 Summit file upload error:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      error: 'Failed to upload files',
      details: error.message,
      errorName: error.name,
      awsConfig: {
        hasRegion: !!process.env.AWS_REGION,
        hasBucket: !!process.env.AWS_S3_BUCKET,
        region: process.env.AWS_REGION,
        bucket: process.env.AWS_S3_BUCKET
      }
    });
  }
}
