import https from 'https';
import fs from 'fs';
import path from 'path';

const filesToDownload = [
  {
    url: 'https://raw.githubusercontent.com/gradle/gradle/v8.7.0/gradle/wrapper/gradle-wrapper.jar',
    dest: path.join(process.cwd(), 'android', 'gradle', 'wrapper', 'gradle-wrapper.jar')
  },
  {
    url: 'https://raw.githubusercontent.com/gradle/gradle/v8.7.0/gradlew',
    dest: path.join(process.cwd(), 'android', 'gradlew')
  },
  {
    url: 'https://raw.githubusercontent.com/gradle/gradle/v8.7.0/gradlew.bat',
    dest: path.join(process.cwd(), 'android', 'gradlew.bat')
  }
];

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    
    const file = fs.createWriteStream(dest);
    
    function fetch(currentUrl) {
      https.get(currentUrl, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
          const redirectUrl = response.headers.location;
          fetch(redirectUrl);
        } else if (response.statusCode === 200) {
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            const stats = fs.statSync(dest);
            console.log(`Downloaded ${path.basename(dest)}: ${stats.size} bytes`);
            if (stats.size < 1000 && path.basename(dest) === 'gradle-wrapper.jar') {
              reject(new Error(`gradle-wrapper.jar downloaded size is too small: ${stats.size} bytes instead of ~60kb.`));
            } else {
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
  console.log('Starting download of pristine Gradle Wrapper files directly from source...');
  try {
    for (const item of filesToDownload) {
      if (fs.existsSync(item.dest)) {
        fs.unlinkSync(item.dest);
      }
      await downloadFile(item.url, item.dest);
    }
    console.log('All Gradle Wrapper files downloaded successfully and replaced!');
    process.exit(0);
  } catch (error) {
    console.error('Error downloading files:', error);
    process.exit(1);
  }
}

main();
