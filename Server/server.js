const express = require('express');
const app = express();
const PORT = 3000;

// Define a basic route for GET requests to the root URL
app.get('/', (req, res) => {
  res.send('Hello World from Express!');
});

// Start the server and listen for incoming requests
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

var pg = require('pg');
var conString = 'postgres://postgres:my_postgres@localhost:5432/PUCCDB';

async function test(){

var client = new pg.Client(conString);
client.connect();

var query = await client.query('select count(1) from "PUCC"');
console.log(query.rows[0].count);

client.end();

}