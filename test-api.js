const fetch = require('node-fetch');
async function test() {
  const loginRes = await fetch('http://localhost:3001/api/admin/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ankit@example.com', password: 'password123' }) // need valid auth, or I can bypass if I mock it or test the router locally?
  });
  console.log(await loginRes.json());
}
test();
