const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ローカルIPアドレスを取得
function getLocalIPAddress() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  
  for (const name of Object.keys(interfaces)) {
    const nets = interfaces[name];
    if (nets) {
      for (const net of nets) {
        if (net.family === "IPv4" && !net.internal) {
          addresses.push(net.address);
        }
      }
    }
  }
  
  return addresses.length > 0 ? addresses[0] : "localhost";
}

// OpenSSLの存在確認
function checkOpenSSL() {
  try {
    execSync('openssl version', { stdio: 'pipe' });
    return true;
  } catch (error) {
    return false;
  }
}

function generateSSLCertificate() {
  const projectRoot = path.join(__dirname, "..");
  const sslDir = path.join(projectRoot, "ssl");
  const localIP = getLocalIPAddress();

  console.log("🔒 SSL証明書生成プロセスを開始します...");
  console.log("=================================");
  console.log(`プロジェクトルート: ${projectRoot}`);
  console.log(`SSL証明書ディレクトリ: ${sslDir}`);
  console.log(`検出されたローカルIP: ${localIP}`);
  console.log("=================================");

  // OpenSSLの確認
  if (!checkOpenSSL()) {
    console.error("❌ OpenSSLがインストールされていません");
    console.log("");
    console.log("💡 OpenSSLをインストールしてください:");
    console.log("");
    console.log("Windows:");
    console.log("  1. https://slproweb.com/products/Win32OpenSSL.html からダウンロード");
    console.log("  2. または Chocolatey: choco install openssl");
    console.log("  3. または Scoop: scoop install openssl");
    console.log("");
    console.log("macOS:");
    console.log("  brew install openssl");
    console.log("");
    console.log("Ubuntu/Debian:");
    console.log("  sudo apt-get install openssl");
    console.log("");
    console.log("CentOS/RHEL:");
    console.log("  sudo yum install openssl");
    console.log("");
    process.exit(1);
  }

  console.log("✅ OpenSSLが見つかりました");

  // sslディレクトリを作成
  if (!fs.existsSync(sslDir)) {
    console.log("📁 SSLディレクトリを作成中...");
    fs.mkdirSync(sslDir, { recursive: true });
    console.log("✅ SSLディレクトリを作成しました");
  } else {
    console.log("📁 SSLディレクトリが既に存在します");
  }

  const keyPath = path.join(sslDir, "key.pem");
  const certPath = path.join(sslDir, "cert.pem");
  const configPath = path.join(sslDir, "openssl.conf");

  // 既存の証明書を確認
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    console.log("⚠️  既存のSSL証明書が見つかりました");
    console.log("証明書を上書きしますか？ (既存の証明書はバックアップされます)");
    
    // バックアップ作成
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupKeyPath = path.join(sslDir, `key_backup_${timestamp}.pem`);
    const backupCertPath = path.join(sslDir, `cert_backup_${timestamp}.pem`);
    
    fs.copyFileSync(keyPath, backupKeyPath);
    fs.copyFileSync(certPath, backupCertPath);
    
    console.log(`📦 バックアップを作成しました:`);
    console.log(`  ${backupKeyPath}`);
    console.log(`  ${backupCertPath}`);
  }

  try {
    // 秘密鍵を生成
    console.log("🔑 秘密鍵を生成中...");
    execSync(`openssl genrsa -out "${keyPath}" 2048`, { 
      stdio: ['pipe', 'pipe', 'inherit'] 
    });
    console.log("✅ 秘密鍵の生成が完了しました");

    // SAN（Subject Alternative Name）設定ファイルを作成
    const sanConfig = `[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
C=JP
ST=Tokyo
L=Tokyo
O=LocalScreenShare
OU=Development
CN=${localIP}

[v3_req]
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectKeyIdentifier = hash
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = *.local
DNS.3 = *.localhost
IP.1 = 127.0.0.1
IP.2 = ${localIP}
IP.3 = ::1`;

    console.log("📝 OpenSSL設定ファイルを作成中...");
    fs.writeFileSync(configPath, sanConfig);
    console.log("✅ OpenSSL設定ファイルを作成しました");

    // 自己署名証明書を生成
    console.log("📜 自己署名証明書を生成中...");
    execSync(
      `openssl req -new -x509 -key "${keyPath}" -out "${certPath}" -days 365 -config "${configPath}" -extensions v3_req`,
      { stdio: ['pipe', 'pipe', 'inherit'] }
    );
    console.log("✅ 自己署名証明書の生成が完了しました");

    // 設定ファイルを削除
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
      console.log("🧹 一時設定ファイルを削除しました");
    }

    // 証明書の詳細を表示
    console.log("=================================");
    console.log("🎉 SSL証明書が正常に生成されました！");
    console.log("=================================");

    // ファイルサイズの確認
    const keyStats = fs.statSync(keyPath);
    const certStats = fs.statSync(certPath);
    
    console.log(`証明書の詳細:`);
    console.log(`  秘密鍵: ${keyPath} (${keyStats.size} bytes)`);
    console.log(`  証明書: ${certPath} (${certStats.size} bytes)`);
    console.log("");

    // 証明書の内容を確認
    try {
      const certInfo = execSync(`openssl x509 -in "${certPath}" -text -noout`, { encoding: 'utf8' });
      const subjectMatch = certInfo.match(/Subject: (.+)/);
      const validFromMatch = certInfo.match(/Not Before: (.+)/);
      const validToMatch = certInfo.match(/Not After : (.+)/);
      
      if (subjectMatch) console.log(`  Subject: ${subjectMatch[1].trim()}`);
      if (validFromMatch) console.log(`  有効期間: ${validFromMatch[1].trim()}`);
      if (validToMatch) console.log(`  有効期限: ${validToMatch[1].trim()}`);
    } catch (error) {
      console.log("  証明書の詳細確認をスキップしました");
    }

    console.log("");
    console.log("⚠️  ブラウザでの初回アクセス時の注意:");
    console.log("   証明書の警告が表示された場合：");
    console.log("   1. 「詳細設定」または「Advanced」をクリック");
    console.log("   2. 「安全ではないページに移動」または");
    console.log("      「Proceed to [IP address] (unsafe)」をクリック");
    console.log("");
    console.log("📍 アクセス用URL:");
    console.log(`   ローカル: https://localhost:3000`);
    console.log(`   ネットワーク: https://${localIP}:3000`);
    console.log("");
    console.log("🔄 サーバーを起動/再起動してHTTPSを有効にしてください:");
    console.log("   npm run build && npm start");
    console.log("=================================");

  } catch (error) {
    console.error("❌ SSL証明書の生成に失敗しました:");
    console.error(error.message);
    console.log("");
    console.log("🔍 トラブルシューティング:");
    console.log("1. OpenSSLが正しくインストールされているか確認");
    console.log("2. パスに特殊文字やスペースが含まれていないか確認");
    console.log("3. 書き込み権限があるか確認");
    console.log("4. ウイルス対策ソフトが干渉していないか確認");
    console.log("");
    console.log("または、localhost (http://localhost:3001) でテストしてください。");
    process.exit(1);
  }
}

// 実行
generateSSLCertificate();