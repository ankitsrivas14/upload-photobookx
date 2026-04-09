const http = require('http');

http.get('http://localhost:3001/api/admin/auth/me', (res) => {
  console.log('Status:', res.statusCode);
  res.on('data', d => process.stdout.write(d));
}).on('error', e => console.error(e));
