const express = require('express');
const app = express();
const cors = require('cors')
const PORT = 3000;
app.use(cors());

//-----------------------database connection--------------------------
var pg = require('pg');
var conString = 'postgres://postgres:my_postgres@localhost:5432/PUCCDB';

app.get('/pucc_issued', async (req, res) => {

  var client = new pg.Client(conString);
  await client.connect();

  var query = await client.query('select count(1) from "PUCC"');
  var result = query.rows[0].count;
  await client.end();

  res.json({ 'count': result });
});

app.get('/vendor_registered', async (req, res) => {

  var client = new pg.Client(conString);
  await client.connect();

  var query = await client.query('SELECT count(1) FROM "Vendor"');
  var result = query.rows[0].count;
  await client.end();

  res.json({ 'count': result });
});

app.get('/pucc_defaulter', async (req, res) => {
  var date = new Date().toISOString();

  var client = new pg.Client(conString);
  await client.connect();


  var query = await client.query(`SELECT count(1) from "PUCC" WHERE "Valid_Till" < '${date.split('T')[0]}'`);

  var result = query.rows[0].count;
  await client.end();

  res.json({ 'count': result });
});

app.get('/pucc_num_type', async (req, res) => {
  var date = new Date().toISOString();

  var client = new pg.Client(conString);
  await client.connect();

  var result = await client.query('SELECT "Type", COUNT(*) FROM "PUCC" as P GROUP BY "Type";');
  await client.end();

  res.json({ 'petrol': result.rows[1].count, 'diesel': result.rows[2].count, 'cng': result.rows[0].count });
});

app.get('/registered_vendors', async (req, res) => {
  var date = new Date().toISOString();

  var client = new pg.Client(conString);
  await client.connect();

  var result = await client.query('SELECT "Vendor_No", "GST_No", "Name", "Location" FROM "Vendor";');
  console.log(result.rows);
  await client.end();

  res.send(result.rows);
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
