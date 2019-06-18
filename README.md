lbmesh-s3-upload-resize
===
A simple way to upload files to s3 and, optionally, resize them. Uses
s3.upload().

## Installation

  $ npm install --save lbmesh-s3-upload-resize

## Usage

#### Upload 

```javascript
var s3UploadResize = require('lbmesh-s3-upload-resize');
var rName = 'test/resize_test.jpg';
s3UploadResize.uploadToS3('test.jpg', 'close5-legacy-staging', rName, '256x256', function(err, s3Url) {
    if (err) {
        console.log(err);
        return;
    }
    console.log('Uploaded to:',s3Url);
});
```

#### Initialization (optional)
You can pass a different `logger` or `extraOptions` (See: http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#createMultipartUpload-property ) 


```javascript
var s3UploadResize = require('s3_upload_resize');
var debug = require('debug')('mymodule');

s3UploadResize.init({
  logger : debug,
   extraOptions : {CacheControl : 'public, max-age=31557600'} 
});

var rName = 'test/resize_test2.jpg';
s3UploadResize.uploadToS3('test.jpg', 'close5-legacy-staging', rName, '256x256', function(err, s3Url) {
    if (err) {
        console.log(err);
        return;
    }
    console.log('Uploaded to:',s3Url);
});
  
```

## NOTES
You must have the AWS_ACCESS_KEY_ID and the AWS_SECRET_ACCESS_KEY in the
environment to complete the upload to s3.


## License
The MIT License (MIT)
