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
    
    console.log('🔍 Backend received fileList:', fileList);
    console.log('🔍 Organization:', organizationName);
    
    if (!fileList || !Array.isArray(fileList) || fileList.length === 0) {
      console.log('❌ No files or invalid fileList array');
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
        console.log('🔍 Processing file:', fileInfo);
        
        const isCatalogueFile = fileInfo.fieldName === 'catalogFile';
        const isHighlightImage = fileInfo.fieldName === 'highlightImage';
        
        console.log('🔍 isCatalogueFile:', isCatalogueFile);
        console.log('🔍 isHighlightImage:', isHighlightImage);
        
        const fileName = fileInfo.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        
        // Determine folder based on file type
        let subFolder = 'docs/'; // default
        if (isCatalogueFile) {
          subFolder = 'catalogue/';
        } else if (isHighlightImage) {
          subFolder = 'highlights/';
        }
        
        const s3Key = `${folderPath}${subFolder}${fileName}`;
        
        console.log('🔍 S3 key will be:', s3Key);
        
        // Create presigned URL for upload
        const command = new PutObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET,
          Key: s3Key,
          ContentType: fileInfo.type || 'application/octet-stream'
        });
        
        const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour
        
        uploadUrls.push({
          fileName: fileInfo.name,
          fieldName: fileInfo.fieldName,
          presignedUrl: presignedUrl,
          publicUrl: `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
          s3Key: s3Key,
          isCatalogue: isCatalogueFile,
          isHighlight: isHighlightImage
        });
        
        console.log(`📄 Created presigned URL for: ${fileInfo.name} -> ${subFolder}`);
        
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
