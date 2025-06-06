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
    // Import AWS SDK
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    
    const { fileList, organizationName, token } = req.body;
    
    if (!fileList || !Array.isArray(fileList) || fileList.length === 0) {
      res.status(400).json({ error: 'No files specified' });
      return;
    }

    console.log(`📝 Creating presigned URLs for ${fileList.length} files...`);

    // Initialize S3 client
    const s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });

    const folderPath = `vendors/${organizationName.replace(/[^a-zA-Z0-9 ]/g, '-').replace(/\s+/g, '-')}/`;
    const uploadUrls = [];

    // Generate presigned URL for each file
    for (const fileInfo of fileList) {
      try {
        const isCatalogueFile = fileInfo.fieldName === 'catalogFile';
        const fileName = fileInfo.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const s3Key = `${folderPath}${isCatalogueFile ? 'catalogue/' : 'docs/'}${fileName}`;
        
        // Create presigned URL for upload
        const command = new PutObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET,
          Key: s3Key,
          ContentType: fileInfo.type,
          ACL: 'public-read'
        });
        
        const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour
        
        uploadUrls.push({
          fileName: fileInfo.name,
          fieldName: fileInfo.fieldName,
          presignedUrl: presignedUrl,
          publicUrl: `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
          s3Key: s3Key,
          isCatalogue: isCatalogueFile
        });
        
        console.log(`📄 Created presigned URL for: ${fileInfo.name}`);
        
      } catch (fileError) {
        console.error(`💥 Error creating URL for ${fileInfo.name}:`, fileError);
      }
    }

    console.log(`🎉 Generated ${uploadUrls.length} presigned URLs!`);

    res.status(200).json({
      success: true,
      uploadUrls: uploadUrls,
      folderPath: folderPath
    });

  } catch (error) {
    console.error('💥 Presigned URL error:', error);
    res.status(500).json({ 
      error: 'Failed to generate upload URLs', 
      details: error.message 
    });
  }
}
