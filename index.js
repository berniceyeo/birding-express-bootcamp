import express from 'express';
import pg from 'pg';
import methodOverride from 'method-override';
import moment from 'moment';
import cookieParser from 'cookie-parser';
import jsSHA from 'jssha';

const app = express();
const PORT = process.argv[2];
const { Pool } = pg;
const SALT = 'birdwatcher';

app.set('view engine', 'ejs');
app.use(methodOverride('_method'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

const pgConnectionConfigs = {
  user: 'bernice',
  host: 'localhost',
  database: 'birding',
  port: 5432, // Postgres server always runs on this port by default
};

const pool = new Pool(pgConnectionConfigs);

/**
 * Generates object to be uploaded into the ejs for form validations
 * @param {string} str1 class for email validation
 * @param {string} str2 class for password validation
 * @param {string} str3 text used in pw feedback
 * @param {string} str4 text used in email feedback
 * @returns object
 */
const generateObj = (str1, str2, str3, str4) => {
  const object = {
    emailvalid: str1,
    pwvalid: str2,
    pwfeedback: str3,
    emailfeedback: str4,
  };
  return object;
};

const hash = (string) => {
  // intialise the SHA object
  const shaObj = new jsSHA('SHA-512', 'TEXT', { encoding: 'UTF8' });
  // create an unhashed cookie string based on stri and salt
  const unhashedCookieString = `${string}-${SALT}`;
  // generate a hashed cookie string using SHA object
  shaObj.update(unhashedCookieString);
  // get the hashed password
  const hashedItem = shaObj.getHash('HEX');
  return hashedItem;
};

// GET req to submit a new note
app.get('/note', (request, response) => {
  const { username } = request.cookies;
  pool.query('SELECT * FROM species', (error, result) => {
    if (error) {
      console.log('Error executing query', error.stack);
      response.status(503).send(result.rows);
      return;
    }

    const object = {
      species: result.rows,
      username,
    };
    response.render('notes', object);
  });
});

// POST req to upload the note to the notes table
app.post('/note', (request, response) => {
  const n = { ...request.body };
  const dt = moment(n.date_time).format('DD MMM YYYY hh:mm');
  const input = [n.habitat, dt, n.app, n.behaviour, n.vocal, n.flocksize, n.species];

  // inserting a new note that and returns the id of the note
  pool.query('INSERT INTO notes (habitat, date, appearance, behaviour, vocalisations, flocksize, species_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id', input, (error, result) => {
    if (error) {
      console.log('Error executing query', error.stack);
      response.status(503).send(result.rows);
      return;
    }

    let { userid } = request.cookies;
    const { id } = result.rows[0];

    if (typeof userid === 'string') {
      userid = Number(userid);
      const newinput = [Number(userid), id];
      pool.query('INSERT INTO users_notes (user_id, note_id) VALUES ($1, $2)', newinput, (oError, results) => {
        if (oError) {
          console.log('Error executing query', oError.stack);
          response.status(503).send(results.rows);
          return;
        }
        console.log('added');
        response.redirect(`/note/${id}`);
      });
    } else {
      response.redirect(`/note/${id}`);
    }
  });
});

// GET req to signup page
app.get('/signup', (request, response) => {
  const object = generateObj('', '', 'Enter valid passwprd!', 'Enter valid email');
  response.render('signup', object);
});

// POST req to upload new user to the users table
app.post('/signup', (request, response) => {
  const note = { ...request.body };

  pool.query(`SELECT * FROM users WHERE email='${note.email}'`, (error, results) => {
    if (error) {
      console.log('Error executing query', error.stack);
      response.status(503).send(results.rows);
      return;
    }

    // Check if there is a user with the same email
    if (results.rows.length > 0) {
      const object = generateObj('is-invalid', '', 'Enter valid passwprd!', 'Email has already been signed up! Please use another email!');
      response.render('signup', object);
    } else {
      // if the email does not exist, to insert the email and password into users

      // intialise the SHA object
      const shaObj = new jsSHA('SHA-512', 'TEXT', { encoding: 'UTF8' });

      // input the password from the request to the SHA obj
      shaObj.update(note.password);

      // get the hashed password
      const hashedPassword = shaObj.getHash('HEX');

      const input = [note.email, hashedPassword];
      pool.query('INSERT INTO users (email, password) VALUES ($1, $2)', input, (inserterror, result) => {
        if (inserterror) {
          console.log('Error executing query', error.stack);
          response.status(503).send(result.rows);
        }

        response.redirect('/login');
      });
    }
  });
});

// GET req to login page
app.get('/login', (request, response) => {
  const object = generateObj('', '', 'Enter valid passwprd!', 'Enter valid emails!');
  response.render('login', object);
});

// Obtain login details and to retrieve user information from users table
app.post('/login', (request, response) => {
  const note = { ...request.body };

  // to check if the email has been signed up in the users table
  pool.query(`SELECT * FROM users WHERE email='${note.email}'`, (error, result) => {
    if (error) {
      console.log('Error executing query', error.stack);
      response.status(503).send(result.rows);
      return;
    }

    // if there is no such email in the users table to send back invalid res
    if (result.rows.length === 0) {
      const object = generateObj('is-invalid', '', 'Enter valid password!', 'Email was not registered, please sign up!');
      response.render('login', object);
      return;
    }

    const user = result.rows[0];
    // check if the password is not correct
    // initialise SHA object again
    const shaObj = new jsSHA('SHA-512', 'TEXT', { encoding: 'UTF8' });
    shaObj.update(note.password);
    const hashedPassword = shaObj.getHash('HEX');
    console.log(hashedPassword, user.password);

    if (user.password !== hashedPassword) {
      const object = generateObj('is-valid', 'is-invalid', 'Wrong Password!', '');
      response.render('login', object);
    } else {
      // if password is correct, and the user has successfully logged in
      // create cookie of the user that has logged in
      response.cookie('username', user.username);
      response.cookie('userid', user.id);
      response.redirect('/note/all');
    }
  });
});

app.get('/logout', (req, res) => {
  res.clearCookie('username');
  res.clearCookie('userid');
  res.redirect('/note/all');
});

app.get('/note/all', (request, response) => {
  const { username } = request.cookies;
  console.log(username);
  pool.query('SELECT * FROM notes', (error, results) => {
    if (error) {
      console.log('Error executing query', error.stack);
      response.status(503).send(results.rows);
      return;
    }

    if (results.rows.length === 0) {
      response.render('error', { text: 'There are no notes' });
      return;
    }

    const ejsdata = results.rows;
    response.render('allnotes', { ejsdata, username });
  });
});

app.get('/note/:id', (request, response) => {
  const id = Number(request.params.id);

  pool.query(`SELECT notes.id, notes.habitat, notes.date, notes.behaviour, notes.appearance, notes.vocalisations, notes.flocksize, notes.species_id, species.name FROM notes INNER JOIN species ON notes.species_id = species.id WHERE notes.id='${id}'`, (error, results) => {
    if (error) {
      console.log('Error executing query', error.stack);
      response.status(503).send(results.rows);
      return;
    }

    if (results.rows.length === 0) {
      response.render('error', { text: 'No notes matches search' });
      return;
    }

    const { username } = request.cookies;
    const ejsdata = results.rows[0];
    response.render('generatednote', { ejsdata, username });
  });
});

app.put('/note/:id', (request, response) => {
  const { id } = request.params;
  const input = { ...request.body };
  const flocksize = Number(input.flocksize);
  const species = Number(input.species);
  const date = moment(input.date_time).format('DD MMM YYYY hh:mm');
  pool.query(`UPDATE notes SET habitat='${input.habitat}', date='${date}', appearance='${input.app}', behaviour='${input.behaviour}', vocalisations='${input.vocal}', flocksize=${flocksize}, species_id=${species} WHERE id=${id}`, (error, results) => {
    if (error) {
      console.log('Error executing query', error.stack);
      response.status(503).send(results.rows);
      return;
    }

    response.redirect(`/note/${id}`);
  });
});

app.delete('/note/:id', (request, response) => {
  const { id } = request.params;
  pool.query(`DELETE FROM notes WHERE id=${id}`, (error, results) => {
    if (error) {
      console.log('Error executing query', error.stack);
      response.status(503).send(results.rows);
      return;
    }
    console.log('sucessfully deleted from notes data');
    pool.query(`DELETE FROM users_notes WHERE note_id=${id}`, (errors, result) => {
      if (errors) {
        console.log('Error executing query', error.stack);
        response.status(503).send(result.rows);
        return;
      }
      console.log('deleted from user_notes table');
    });
  });

  response.redirect('/note/all');
});

app.get('/note/:id/edit', (request, response) => {
  const { id } = request.params;
  const userid = Number(request.cookies.userid);

  pool.query(`SELECT * FROM users_notes WHERE note_id=${id}`, (error, result) => {
    if (error) {
      console.log('Error executing query', error.stack);
      response.status(503).send(result.rows);
      return;
    }

    // if there is no user, send back that they cannot edit
    if (typeof request.cookies.userid === 'undefined') {
      response.render('error', { text: 'Please Login! Permission Denied!' });
      return;
    }

    const user = result.rows[0].user_id;
    // if the user is the one that created the note, they can edit it
    if (user === userid) {
      pool.query(`SELECT * FROM notes WHERE id=${id}`, (oerror, results) => {
        if (oerror) {
          console.log('Error executing query', error.stack);
          response.status(503).send(results.rows);
          return;
        }

        if (results.rows.length === 0) {
          response.send('no notes matches search');
          return;
        }

        const { username } = request.cookies;
        const ejsdata = results.rows[0];

        pool.query('SELECT * FROM species', (serror, sresult) => {
          if (serror) {
            console.log('Error executing query', serror.stack);
            response.status(503).send(sresult.rows);
            return;
          }

          const object = {
            species: sresult.rows,
            username,
            ejsdata,
          };
          response.render('editnote', object);
        });
      });
    } else {
      response.render('error', { text: 'Permission Denied!' });
    }
  });
});

// GET req to get user related information
app.get('/profile', (request, response) => {
  if (request.cookies.userid) {
    const userid = Number(request.cookies.userid);

    pool.query(`SELECT notes.id, notes.habitat, notes.date, notes.behaviour, notes.appearance, notes.vocalisations, notes.flocksize, users_notes.id, users_notes.user_id, users_notes.note_id FROM notes INNER JOIN users_notes ON users_notes.note_id = notes.id WHERE users_notes.user_id='${userid}'`, (error, results) => {
      if (error) {
        console.log('Error executing query', error.stack);
        response.status(503).send(results.rows);
        return;
      }

      if (results.rows.length === 0) {
        response.render('error', { text: 'User has no notes!' });
        return;
      }

      const ejsdata = results.rows;
      const { username } = request.cookies;

      response.render('profile', { ejsdata, username });
    });
  }
});

// GET req to submit a new species
app.get('/species', (request, response) => {
  const { username } = request.cookies;
  response.render('species', { username });
});

// POST req to upload new species
app.post('/species', (request, response) => {
  const species = { ...request.body };
  const input = [species.speciesname, species.scientificnm];

  // inserting a new note that and returns the id of the note
  pool.query('INSERT INTO species (name, scientific_name) VALUES ($1, $2) RETURNING id', input, (error, result) => {
    if (error) {
      console.log('Error executing query', error.stack);
      response.status(503).send(result.rows);
      return;
    }

    const { id } = result.rows[0];

    response.redirect(`/species/${id}`);
  });
});

// GET req to get all species
app.get('/species/all', (request, response) => {
  const { username } = request.cookies;
  pool.query('SELECT * FROM species', (error, result) => {
    if (error) {
      console.log('Error executing query', error.stack);
      response.status(503).send(result.rows);
      return;
    }

    const ejsdata = result.rows;
    response.render('allspecies', { ejsdata, username });
  });
});

// GET req to get all notes belonging to a certain species
app.get('/species/:id', (request, response) => {
  const id = Number(request.params.id);
  const { username } = request.cookies;
  pool.query(`SELECT notes.id, notes.habitat, notes.date, notes.behaviour, notes.appearance, notes.vocalisations, notes.flocksize, notes.species_id, species.name   FROM notes INNER JOIN species ON notes.species_id = species.id WHERE notes.id=${id}`, (error, result) => {
    if (error) {
      console.log('Error executing query', error.stack);
      response.status(503).send(result.rows);
      return;
    }

    if (result.rows.length === 0) {
      response.render('error', { text: 'There are no notes from that species' });
      return;
    }

    const ejsdata = result.rows;
    response.render('eachspecies', { ejsdata, username });
  });
});

// delete the species
app.delete('/species/:id', (request, response) => {
  const { id } = request.params;
  pool.query(`DELETE FROM species WHERE id=${id}`, (error, results) => {
    if (error) {
      console.log('Error executing query', error.stack);
      response.status(503).send(results.rows);
      return;
    }
    response.redirect('/note/all');
  });
});

app.get('/species/:id/edit', (request, response) => {
  const { id } = request.params;
  const { username } = request.cookies;
  pool.query(`SELECT * FROM species WHERE id=${id}`, (error, result) => {
    if (error) {
      console.log('Error executing query', error.stack);
      response.status(503).send(result.rows);
      return;
    }

    const ejsdata = result.rows[0];

    response.render('editspecies', { ejsdata, username });
  });
});

app.put('/species/:id', (request, response) => {
  const id = Number(request.params.id);
  const input = { ...request.body };
  pool.query(`UPDATE species SET name='${input.speciesname}',  scientific_name='${input.scientificnm}' WHERE id=${id}`, (error, results) => {
    if (error) {
      console.log('Error executing query', error.stack);
      response.status(503).send(results.rows);
      return;
    }

    console.log(results.rows);
    response.redirect('/species/all');
  });
});

app.listen(PORT);
