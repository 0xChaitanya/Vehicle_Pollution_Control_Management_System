const express = require('express');
const hashing = require('bcrypt');
const cors = require('cors')
const pg = require('pg');
const { escape } = require('querystring');
const fs = require('fs').promises;

const app = express();
const PORT = 3000;
app.use(cors());

//-----------------------database connection--------------------------
var conString = 'postgres://postgres:my_postgres@localhost:5432/PUCCDB';
var conStringAuthDB = 'postgres://postgres:my_postgres@localhost:5432/AUTHDB';

function generatePUCCNumber() {
	const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

	function randLetter() {
		return letters[Math.floor(Math.random() * letters.length)];
	}

	function randDigit() {
		return Math.floor(Math.random() * 10);
	}

	return "DL"
		+ randDigit()
		+ randLetter()
		+ randLetter()
		+ randLetter()
		+ randLetter()
		+ randLetter()
		+ randLetter()
		+ randLetter()
		+ randLetter()
		+ randDigit();
}

function generatelocationId() {
	return Math.floor(100000 + Math.random() * 900000);
}

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

	var profile = { name: details.rows[0].Name, adhaar: details.rows[0].Adhaar_No, contact: details.rows[0].Contact_No, home_addr: details.rows[0].Home_Address, vehicle: [], pucc: [], pending_pucc:[]};

	for (let i = 0; i < details.rows.length; i++) {
		var fueltype = await client.query(`SELECT "Fuel_Type" FROM "Vehicle" WHERE "Vehicle_No" = '${details.rows[i].Vehicle_No}'`)
		profile.vehicle.push({ number: details.rows[i].Vehicle_No, fuel_type: fueltype.rows[0].Fuel_Type });
	}

	var pucc_details = await client.query(`SELECT "PUCC_No", "Issued_On", "Valid_Till" FROM "PUCC" WHERE "Adhaar_No" = '${adhaar.rows[0].Adhaar_No}'`);
	var pending_approval = await client.query(`SELECT "PUCC_No" FROM "Registration" WHERE "Adhaar_No" = '${adhaar.rows[0].Adhaar_No}' AND "PUCC_No" NOT IN (SELECT "PUCC_No" from "PUCC")`);

	var date = new Date().toISOString();

	for (let i = 0; i < pucc_details.rows.length; i++) {
		profile.pucc.push({ number: pucc_details.rows[i].PUCC_No, issued_on: pucc_details.rows[i].Issued_On, validity: pucc_details.rows[i].Valid_Till, status: "e" });

		if (new Date(pucc_details.rows[0].Valid_Till) >= new Date(date.split('T')[0])) {
			profile.pucc[i].status = "a";
		} else if (new Date(pucc_details.rows[0].Valid_Till) < new Date(date.split('T')[0])) {
			profile.pucc[i].status = "e";
		}
		else {
			profile.pucc[i].status = "u";
		}
	}

	for (let i = 0; i < pending_approval.rows.length; i++){
		profile.pending_pucc.push({pucc_no : pending_approval.rows[i].PUCC_No});
	}

	res.send(JSON.stringify(profile));
});

app.post('/vendor_time', async (req, res) => {
	var client = new pg.Client(conString);
	await client.connect();

	var query = await client.query(`SELECT "Start_Time", "End_Time", "Slot_Duration", "Day" FROM "Vendor_Schedule" WHERE "Vendor_No" = ${req.body.number}`);

	return res.send(JSON.stringify(query));
});

app.get('/load_vendor', async (req, res) => {
	var client = new pg.Client(conStringAuthDB);
	await client.connect();
	// var vnumber = '';

	//------------------------loading user_id from file---------------------------
	try {
		const data = await fs.readFile('../Frontend/role.json', 'utf8');
		const obj = JSON.parse(data);
		// console.log(obj.userid.rows[0].User_ID);
		var vnumber = await client.query(`SELECT "Vendor_No" FROM "Users_Auth" WHERE "User_ID" = ${obj.userid.rows[0].User_ID}`);
	}
	catch (error) {
		console.error("Failed reading file : ", error);
	}

	client = new pg.Client(conString);
	await client.connect();

	var details = await client.query(`SELECT * FROM "Vendor" WHERE "Vendor_No" = ${vnumber.rows[0].Vendor_No}`);

	var profile = { number: vnumber.rows[0].Vendor_No, name: details.rows[0].Name, gstin: details.rows[0].GST_No, type: [], location: details.rows[0].Location, total_pucc: details.rows[0].Total_PUCC_Issued, appointments: [], total_revenue: 0 };

	var category = await client.query(`SELECT * FROM "Vendor_Category" WHERE "Vendor_No" = '${vnumber.rows[0].Vendor_No}'`);

	for (let i = 0; i < category.rows.length; i++) {
		profile.type.push(category.rows[i].Type);
	}

	var appointments_today = await client.query(`SELECT "Vehicle_No" FROM "Testing" NATURAL JOIN "Registration" WHERE "Vendor_No" = ${vnumber.rows[0].Vendor_No}`);

	var date = new Date().toISOString();
	for (let i = 0; i < appointments_today.rows.length; i++) {
		// if (JSON.stringify(appointments_today.rows[i].Time_Slot).split('T')[0] < `"${date.split('T')[0]}`) {
			profile.appointments.push({ vehicle_no: appointments_today.rows[i].Vehicle_No});
			// profile.appointments.push({ vehicle_no: appointments_today.rows[i].Vehicle_No, fuel: appointments_today.rows[i].Fuel_Type, time: appointments_today.rows[i].Time_Slot });
		// }
	}

	var revenue = await client.query(`SELECT "Price" FROM "PUCC_seller" NATURAL JOIN "Max_PUCC_Price" WHERE "Vendor_No" = ${vnumber.rows[0].Vendor_No};`);

	for (let i = 0; i < revenue.rows.length; i++) {
		profile.total_revenue += parseInt(revenue.rows[i].Price);
	}

	res.send(JSON.stringify(profile));
});

function toPostgresTimestamp(str) {
    return str;
}

// app.post('/new_pucc', async (req, res) => {
// 	var client = new pg.Client(conString);
// 	await client.connect();

// 	var locationtimeid = generatelocationId();
// 	var id = await client.query(`SELECT count(1) FROM "Location_Time" WHERE "LocationTimeId" = ${locationtimeid}`)
// 	while (id.rows[0].count != 0){ // keeps generating until hits a new one
// 		locationtimeid = generatelocationId();
// 		id = await client.query(`SELECT count(1) FROM "Location_Time" WHERE "LocationTimeId" = ${locationtimeid}`)
// 	}
// 	// console.log(req.body);

// 	var query = await client.query(`INSERT INTO "Location_Time" VALUES (${locationtimeid}, '${req.body.vendor.split(' , ')[2]}', '${toPostgresTimestamp(req.body.date + " " + req.body.slot)}')`);
	
// 	var query = await client.query(`INSERT INTO "Testing" VALUES ('${req.body.adhaar}', ${parseInt(req.body.vendor.split(' , ')[0])}, ${locationtimeid})`);

// 	var pucc_no = generatePUCCNumber();
// 	id = await client.query(`SELECT count(1) FROM "Registration" WHERE "PUCC_No" = '${pucc_no}'`)
// 	while (id.rows[0].count != 0){
// 		pucc_no = generatePUCCNumber();
// 		id = await client.query(`SELECT count(1) FROM "Registration" WHERE "PUCC_No" = '${pucc_no}'`)
// 	}

// 	var query = await client.query(`INSERT INTO "Registration" VALUES ('${req.body.adhaar}', '${req.body.vehicle_no}', '${pucc_no}')`);
	
// });

app.post('/new_pucc', async (req, res) => {
    const client = new pg.Client(conString);
    await client.connect();

    const location = req.body.vendor.split(' , ')[2];
    const timeSlot = toPostgresTimestamp(req.body.date + " " + req.body.slot);

    try {
        // check if slot is free
        const check = await client.query(
            `SELECT count(1) FROM "Location_Time" WHERE "Location" = $1 AND "Time" = $2`,
            [location, timeSlot]
        );

        // simulate conflict
        console.log(`Checking slot for ${req.body.adhaar}...`);
        await new Promise(resolve => setTimeout(resolve, 5000)); 

        if (check.rows[0].count == 0) {
            // try to insert
            const locationtimeid = generatelocationId();
            
            await client.query(
                `INSERT INTO "Location_Time" VALUES ($1, $2, $3)`,
                [locationtimeid, location, timeSlot]
            );

            // user A won
            res.json({ success: true, message: "Booking Confirmed!" });
        } else {
            // user b hits this
            res.status(409).json({ success: false, message: "The slot was just booked by someone else! Please choose another one." });
        }
    } catch (error) {
        res.status(409).json({ success: false, message: "The slot was just booked by someone else! Please choose another one." });
    } finally {
        await client.end();
    }
});

// app.post('/renew_pucc', async (req, res) => {
// 	var client = new pg.Client(conString);
// 	await client.connect();
	
// 	console.log(req.body);
	
// 	// console.log(id);
	
// 	var locationtimeid = generatelocationId();
// 	// console.log(locationtimeid);
// 	var id = await client.query(`SELECT count(1) FROM "Location_Time" WHERE "LocationTimeId" = ${locationtimeid}`)
// 	while (id.rows[0].count != 0){ // keeps generating until hits a new one
// 		locationtimeid = generatelocationId();
// 		id = await client.query(`SELECT count(1) FROM "Location_Time" WHERE "LocationTimeId" = ${locationtimeid}`)
// 	}
	
// 	var id = await client.query(`SELECT * FROM "PUCC" WHERE "PUCC_No" = '${req.body.pucc_no}'`);
// 	console.log(id.rows);

// 	var query = await client.query(`INSERT INTO "Location_Time" VALUES (${locationtimeid}, '${req.body.vendor.split(' , ')[2]}', '${toPostgresTimestamp(req.body.date + " " + req.body.slot)}')`);
	
// 	// var query = await client.query(`INSERT INTO "Testing" VALUES ('${id.rows[0].Adhaar_No}', ${parseInt(req.body.vendor.split(' , ')[0])}, ${locationtimeid}, ${})`); //PROBLEM HERE
// });

app.post('/renew_pucc', async (req, res) => {
    const client = new pg.Client(conString);
    await client.connect();

    try {
        await client.query('BEGIN');

        console.log("Processing renewal for:", req.body);

        let locationtimeid = generatelocationId();
        let idCheck = await client.query('SELECT count(1) FROM "Location_Time" WHERE "LocationTimeId" = $1', [locationtimeid]);
        
        while (parseInt(idCheck.rows[0].count) !== 0) {
            locationtimeid = generatelocationId();
            idCheck = await client.query('SELECT count(1) FROM "Location_Time" WHERE "LocationTimeId" = $1', [locationtimeid]);
        }

        const puccRes = await client.query('SELECT * FROM "PUCC" WHERE "PUCC_No" = $1', [req.body.pucc_no]);
        
        if (puccRes.rows.length === 0) {
            throw new Error("PUCC Number not found in database.");
        }

        const adhaarNo = puccRes.rows[0].Adhaar_No;
        const vendorParts = req.body.vendor.split(' , ');
        const vendorId = parseInt(vendorParts[0]);
        const vendorLocation = vendorParts[2];
        const timestamp = toPostgresTimestamp(req.body.date + " " + req.body.slot);

        await client.query(
            `INSERT INTO "Location_Time" ("LocationTimeId", "Location", "Time_Slot") VALUES ($1, $2, $3)`,
            [locationtimeid, vendorLocation, timestamp]
        );

        const testingQuery = `
            INSERT INTO "Testing" ("Adhaar_No", "Vendor_No", "LocationTimeId", "Vehicle_No") 
            VALUES ($1, $2, $3, $4)`;
        await client.query(testingQuery, [adhaarNo, vendorId, locationtimeid, 'DL01PG9275']);

        // commit
        await client.query('COMMIT');
        console.log("Data successfully committed to Database.");
        
        res.status(200).json({ success: true, message: "Appointment booked successfully!" });

    } catch (error) {
        // rollback
        await client.query('ROLLBACK');
        console.error("Transaction Failed (Roll Backed). Reason:", error.message);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        await client.end();
    }
});

/**
 * CONFLICT DEMONSTRATION ENDPOINT
 * This simulates a "Lost Update" or Race Condition
 */
app.post('/simulate-conflict', async (req, res) => {
    const { vehicle_id, new_status } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        
        // Simulate a delay to allow another request to "conflict"
        // In a real scenario, this happens if two people update the same vehicle at once
        await new Promise(resolve => setTimeout(resolve, 5000)); 

        const query = `UPDATE VEHICLE SET is_compliant = $1 WHERE vehicle_id = $2`;
        await client.query(query, [new_status, vehicle_id]);

        await client.query('COMMIT');
        res.send("Update completed after delay.");
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).send("Conflict occurred.");
    } finally {
        client.release();
    }
});

app.listen(PORT, () => {
	console.log(`Server is running on http://localhost:${PORT}`);
});
