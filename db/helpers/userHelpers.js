module.exports = (db) => {
  const getAllUsers = () => {
    return db.query(`SELECT * FROM users`)
      .then(data => data.rows)
      .catch(err => err.message);
  };

  const getUserByEmail = (email) => {
    return db.query(`SELECT * FROM users WHERE email = '${email}';`)
      .then(data => data.rows[0])
      .catch(err => err.message);
  };

  return { 
    getAllUsers,
    getUserByEmail
  }
}

