const express = require('express');
const hashing = require('bcrypt');
const cors = require('cors')
const pg = require('pg');
const fs = require('fs').promises;

const app = express();
const PORT = 3000;
app.use(cors());

//-----------------------database connection--------------------------
var conString = 'postgres://postgres:my_postgres@localhost:5432/PUCCDB';
var conStringAuthDB = 'postgres://postgres:my_postgres@localhost:5432/AUTHDB';

app.get('/pucc_issued', async (req, res) => {
	// console.log(await hashing.compare('my_password', '$2a$12$P3o.0OPcJtgzeXYYrxI/KuSXcRONjbyp.6yv2/IawJT92I6imXpsO'))

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
	var client = new pg.Client(conString);
	await client.connect();

	var result = await client.query('SELECT "Type", COUNT(*) FROM "PUCC" as P GROUP BY "Type";');
	await client.end();

	res.json({ 'petrol': result.rows[1].count, 'diesel': result.rows[2].count, 'cng': result.rows[0].count });
});

app.get('/registered_vendors', async (req, res) => {
	var client = new pg.Client(conString);
	await client.connect();

	var result = await client.query('SELECT "Vendor_No", "GST_No", "Name", "Location" FROM "Vendor";');
	// console.log(result.rows);
	await client.end();

	res.send(result.rows);
});

app.use(express.json());
app.post('/validate_user', async (req, res) => {
	var client = new pg.Client(conStringAuthDB);
	await client.connect();

	var result = await client.query(`SELECT count(1) FROM "Users_Auth" WHERE "User_Name" = '${req.body.username}' and "Role" = '${req.body.role}'`);
	var pass = await client.query(`SELECT "Password" FROM "Users_Auth" WHERE "User_Name" = '${req.body.username}' and "Role" = '${req.body.role}'`);

	var send_back = { username: false, password: false };
	// console.log(result);

	if (result.rows[0].count != 0) {
		send_back.username = true;
		if (await hashing.compare(req.body.password, pass.rows[0].Password)) {
			send_back.password = true;
		}
	}

	//------------------file handling to save role--------------------
	if (send_back.username && send_back.password) {
		var userid = await client.query(`SELECT "User_ID" FROM "Users_Auth" WHERE "User_Name" = '${req.body.username}' and "Role" = '${req.body.role}'`);
		try {
			const data = { userid: userid };
			await fs.writeFile('../Frontend/role.json', JSON.stringify(data, null, 2), 'utf8');
			console.log("USERID successfully written to the file");
		}
		catch (error) {
			console.error(error);
		}
	}

	return res.send(JSON.stringify(send_back));
});

app.get('/load_user', async (req, res) => {
	var client = new pg.Client(conStringAuthDB);
	await client.connect();
	var adhaar = '';

	//------------------------loading user_id from file---------------------------
	try {
		const data = await fs.readFile('../Frontend/role.json', 'utf8');
		const obj = JSON.parse(data);
		// console.log(obj.userid.rows[0].User_ID);
		adhaar = await client.query(`SELECT "Adhaar_No" FROM "Users_Auth" WHERE "User_ID" = ${obj.userid.rows[0].User_ID}`);
	}
	catch (error) {
		console.error("Failed reading file : ", error);
	}

	client = new pg.Client(conString);
	await client.connect();

	var details = await client.query(`SELECT * FROM "Owner" WHERE "Adhaar_No" = '${adhaar.rows[0].Adhaar_No}'`);
	// console.log(details);

	var profile = { name: details.rows[0].Name, adhaar: details.rows[0].Adhaar_No, contact: details.rows[0].Contact_No, home_addr: details.rows[0].Home_Address, vehicle: [], pucc: [] };

	for (let i = 0; i < details.rows.length; i++) {
		var fueltype = await client.query(`SELECT "Fuel_Type" FROM "Vehicle" WHERE "Vehicle_No" = '${details.rows[i].Vehicle_No}'`)
		profile.vehicle.push({ number: details.rows[i].Vehicle_No, fuel_type: fueltype.rows[0].Fuel_Type });
	}

	var pucc_details = await client.query(`SELECT "PUCC_No", "Issued_On", "Valid_Till" FROM "PUCC" WHERE "Adhaar_No" = '${adhaar.rows[0].Adhaar_No}'`);

	var date = new Date().toISOString();

	for (let i = 0; i < pucc_details.rows.length; i++) {
		profile.pucc.push({ number: pucc_details.rows[i].PUCC_No, issued_on: pucc_details.rows[i].Issued_On, validity: pucc_details.rows[i].Valid_Till, status: "e"});

		if (new Date(pucc_details.rows[0].Valid_Till) >= new Date(date.split('T')[0])) {
			profile.pucc[i].status = "a";
		} else if (new Date(pucc_details.rows[0].Valid_Till) < new Date(date.split('T')[0])) {
			profile.pucc[i].status = "e";
		}
		else{
			profile.pucc[i].status = "u";
		}
	}


	res.send(JSON.stringify(profile));
});

app.listen(PORT, () => {
	console.log(`Server is running on http://localhost:${PORT}`);
});
