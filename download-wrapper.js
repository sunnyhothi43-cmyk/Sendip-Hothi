import https from 'https';
import fs from 'fs';
import path from 'path';

const wrapperJarCandidates = [
  'https://raw.githubusercontent.com/android/sunflower/main/gradle/wrapper/gradle-wrapper.jar',
  'https://raw.githubusercontent.com/android/architecture-samples/main/gradle/wrapper/gradle-wrapper.jar',
  'https://raw.githubusercontent.com/gradle/wrapper-validation-action/main/gradle/wrapper/gradle-wrapper.jar',
  'https://raw.githubusercontent.com/actions/starter-workflows/main/ci/gradle/wrapper/gradle-wrapper.jar',
  'https://raw.githubusercontent.com/google/ios-device-discovery/master/gradle/wrapper/gradle-wrapper.jar'
];

const otherFiles = [
  {
    url: 'https://raw.githubusercontent.com/gradle/gradle/v8.7.0/gradlew',
    dest: path.join(process.cwd(), 'android', 'gradlew')
  },
  {
    url: 'https://raw.githubusercontent.com/gradle/gradle/v8.7.0/gradlew.bat',
    dest: path.join(process.cwd(), 'android', 'gradlew.bat')
  }
];

function downloadFile(url, dest, minSize = 0) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    
    const file = fs.createWriteStream(dest);
    
    function fetch(currentUrl) {
      const parsedUrl = new URL(currentUrl);
      const options = {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      };

      https.get(options, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
          const redirectUrl = response.headers.location;
          fetch(redirectUrl);
        } else if (response.statusCode === 200) {
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            const stats = fs.statSync(dest);
            if (minSize > 0 && stats.size < minSize) {
              if (fs.existsSync(dest)) fs.unlinkSync(dest);
              reject(new Error(`File downloaded size of ${stats.size} is too small (expected >= ${minSize}).`));
            } else {
              console.log(`Successfully downloaded ${path.basename(dest)} (${stats.size} bytes) from ${currentUrl}`);
              resolve();
            }
          });
        } else {
          file.close();
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
          reject(new Error(`Status Code: ${response.statusCode} for ${currentUrl}`));
        }
      }).on('error', (err) => {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        reject(err);
      });
    }
    
    fetch(url);
  });
}

async function main() {
  console.log('Starting download of pristine Gradle Wrapper files directly from non-LFS sources...');
  
  // 1. Try downloading gradle-wrapper.jar from candidates
  const jarDest = path.join(process.cwd(), 'android', 'gradle', 'wrapper', 'gradle-wrapper.jar');
  if (fs.existsSync(jarDest)) {
    fs.unlinkSync(jarDest);
  }
  
  let jarSuccess = false;
  for (const url of wrapperJarCandidates) {
    try {
      console.log(`Trying to download gradle-wrapper.jar from: ${url}...`);
      await downloadFile(url, jarDest, 50000); // 50KB minimum
      jarSuccess = true;
      break;
    } catch (error) {
      console.warn(`Failed to download from ${url}: ${error.message}. Trying next candidate...`);
    }
  }

  if (!jarSuccess) {
    console.error('All gradle-wrapper.jar download candidates failed!');
    process.exit(1);
  }

  // 2. Download the other files (gradlew, gradlew.bat)
  try {
    for (const item of otherFiles) {
      if (fs.existsSync(item.dest)) {
        fs.unlinkSync(item.dest);
      }
      await downloadFile(item.url, item.dest, 1000); // minimum 1KB
    }
    console.log('All Gradle Wrapper files downloaded successfully and replaced!');
    process.exit(0);
  } catch (error) {
    console.error('Error downloading helper files:', error);
    process.exit(1);
  }
}

main();
