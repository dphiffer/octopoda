const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const sqlite3 = require('sqlite3').verbose();

if (! fs.existsSync('./config.js')) {
	console.log('Please set up config.js.');
	process.exit(1);
}

const config = require('./config');
var api_keys = {
	users: {},
	keys: {}
};
let transporter = nodemailer.createTransport(config.smtp);

let api_keys_path = `${config.data_path}/api_keys.json`;
if (fs.existsSync(api_keys_path)) {
	try {
		const api_keys_json = fs.readFileSync(api_keys_path, 'utf-8');
		api_keys = JSON.parse(api_keys_json);
	} catch (err) {
		console.log(err);
	}
}

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

app.get('/', (req, res) => res.send('Please try again as a POST request.'));

function email_key(email, key, callback) {

	let mail = {
		from: `octopoda <${config.from_email}>`,
		to: email,
		subject: 'ocotopoda API key',
		text: `Hello,

Your Octopoda API key is:
${key}

Enjoy!`
	};

	transporter.sendMail(mail, (err, info) => {
		if (err) {
			console.log(err);
			return callback('Sorry, there was a problem emailing your API key.');
		}
		return callback('Please check your email for your API key.');
	});
}

app.post('/register', (req, res) => {

	if (! req.body.email) {
		res.send(`Please include an 'email' argument: curl -d \"email=you@example.com\" ${config.url}/register`);
		return;
	}

	const email = req.body.email;

	if (api_keys[email]) {
		if (api_keys[email].status != 'active') {
			return res.send('Sorry, your API key inactive.');
		}
		return email_key(email, api_keys[email].key, (msg) => {
			res.send(msg);
		});
	}

	const now = JSON.stringify(new Date()).replace(/"/g, '');
	const key = crypto.randomBytes(16).toString('hex');
	const secret = crypto.randomBytes(8).toString('hex');

	api_keys.users[req.body.email] = {
		key: key,
		secret: secret
	};

	api_keys.keys[key] = {
		created: now,
		status: 'active',
		user: req.body.email
	};

	let api_keys_path = `${config.data_path}/api_keys.json`;
	fs.writeFile(api_keys_path, JSON.stringify(api_keys, null, 4), (err) => {
		if (err) {
			console.log(err);
			res.send('Sorry, there was a problem registering your API key.');
			return;
		}
		email_key(req.body.email, key, (msg) => {
			res.send(msg);
		});
	});
});

app.post('/submit', (req, res) => {

	if (! req.body.api_key) {
		res.send('Sorry, you need to include an api_key.');
		return;
	}

	const key = req.body.api_key;
	if (! api_keys.keys[key]) {
		res.send('Sorry that api_key is invalid.');
		return;
	}

	if (api_keys.keys[key].status != 'active') {
		res.send('Sorry that api_key is not active.');
		return;
	}

	const fields = [];
	const api_key = req.body.api_key;
	for (let field in req.body) {
		if (field == 'api_key') {
			continue;
		}
		fields.push(field);
	}

	fields.sort();
	var values = [];

	for (let field of fields) {
		values.push(`${field}:
${req.body[field]}`);
	}

	values = values.join('\n\n');

	var ip_addr = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
	let to_email = api_keys.keys[key].user;

	let mail = {
		from: `octopoda <${config.from_email}>`,
		to: to_email,
		subject: 'Form submission',
		text: `Here is a new form submission from ${ip_addr}.

${values}
`
	};

	transporter.sendMail(mail, (err, info) => {
		if (err) {
			console.log(err);
			return res.send('Oops, your submission was not handled properly.');
		}
		res.send('Success!');
	});

	let secret = api_keys.users[to_email].secret;
	let db_path = `${config.data_path}/${secret}.db`;
	let setup_db = false;

	if (! fs.existsSync(db_path)) {
		setup_db = true;
	}

	let db = new sqlite3.Database(db_path);
	db.serialize(() => {

		if (setup_db) {
			db.run(`
				CREATE TABLE submission (
					id INTEGER PRIMARY KEY,
					ip_addr VARCHAR(255),
					submitted DATETIME
				);
			`);

			db.run(`
				CREATE TABLE submission_field (
					submission_id INTEGER,
					name VARCHAR(255),
					value TEXT
				);
			`);
		}

		let sql = `
			INSERT INTO submission
			(ip_addr, submitted)
			VALUES (?, CURRENT_TIMESTAMP)
		`;
		db.run(sql, ip_addr, function(err) {

			if (err) {
				console.log(err);
				return;
			}

			let submission_id = this.lastID;

			let query = db.prepare(`
				INSERT INTO submission_field
				(submission_id, name, value)
				VALUES (?, ?, ?)
			`);
			for (let key of fields) {
				query.run([submission_id, key, req.body[key]]);
			}

		});
	});

});

app.listen(config.port, () => {
	console.log(`octopoda listening on port ${config.port}`);
})
