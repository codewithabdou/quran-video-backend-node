import pkg from 'pg';
const { Client } = pkg;

const client = new Client({
  connectionString: "postgresql://quran:quran_secret@localhost:5432/qurandb"
});

async function test() {
  try {
    await client.connect();
    console.log("Successfully connected to the database!");
    const res = await client.query('SELECT NOW()');
    console.log("Current time from DB:", res.rows[0].now);
    await client.end();
  } catch (err) {
    console.error("Connection failed:", err.message);
    process.exit(1);
  }
}

test();
