const { query } = require("express");

module.exports = (db) => {

  // not used as far as I know - Helen
  const getAllQuizzes = () => {
    return db.query(`
      SELECT *
      FROM quizzes;
    `)
      .then(data => data.rows)
      .catch(err => err.message);
  };

  /**
   * Gets listed quizzes given filter and sort options
   * @param {{filterType:string, filterName:string, sortName:string, sortOrder: string}} options 
   */
  const getPublicQuizzes = (options) => {
    // {"filterType":"category","filterName":"TV/Movies","sortName":"created-desc"}
    console.log('options>>', options);
    
    const { filterType, filterName, sortName, sortOrder } = options;
    const queryParams = [];
    
    let queryString = "SELECT quizzes.* ";    
    
    if (sortName === "popular" || sortName === "rating") {

      // choose table to join
      if (sortName === "popular") {
        switch(filterType) {
          case "trivia":
            queryString += ", count(trivia_results) AS total_count FROM quizzes JOIN trivia_results ON quiz_id = quizzes.id";
            break;
          case "personality":
            queryString += ", count(personality_results AS total_count FROM quizzes JOIN trivia_results ON quiz_id = quizzes.id";
            break;
          default:
            queryString += ", count("
        }
      } else {
        table = "ratings";
      }
      queryString += `, count(${table}) AS total_count FROM quizzes JOIN ${table} ON quiz_id = quizzes.id `
    } else {
      queryString += "FROM quizzes "
    }

    queryString += "WHERE listed = true ";

    if (filterName !== "All") {
      // filter by quiz type
      if (filterType === "type") {
        queryParams.push(filterName);
        queryString += `AND type = $${queryParams.length} `;
      
      // filter by quiz category
      } else if (filterType === "category") {
        queryParams.push(filterName);
        queryString += `AND category = $${queryParams.length} `;
      }
    }


    console.log(queryString, queryParams);

    return db.query(queryString, queryParams)
      .then(data => {
        console.log('data>>', data.rows.length);
        return data.rows
      })
      .catch(err => err.message);
  };

  // given userid, returns quizzes that user created
  const getQuizzesForUser = (id) => {
    return db.query(`
      SELECT * FROM quizzes
      JOIN users ON users.id = creator_id
      WHERE creator_id = '${id}';
    `)
      .then(data => data.rows)
      .catch(err => err.message);
  };

  // Adds quiz to db - accepts user_id string, and an object
  const createNewQuiz = (id, info) => {
    const dateString = Date.now();
    const timestamp = new Date(dateString);
    const date = timestamp.toDateString();
    const createdURL = Math.random().toString(20).substr(2, 8);
    return db.query(`
    INSERT INTO quizzes (creator_id, title, photo, listed, url, category, date_created)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
    `, [id, info.title, info.thumbnail, info.listed, createdURL, info.category, date,])
    .then(data => data.rows[0])
    .catch(err => err.message);
  }

  // Sorts form data into questions, answers, and correct(s) - accepts and returns an object
  const sort = function(id, info) {
    const count = info.count;
    const questions = [];
    const answers = [];
    const correct = [];
    for (let i = 1; i <= count; i++) {
      questions.push(info[`question${i}`]);
      answers.push([info[`a${i}`], info[`b${i}`], info[`c${i}`], info[`d${i}`]]);
      correct.push(info[`correct${i}`]);
    };
    return { questions, answers, correct, id }
  }

  // Adds question to db - accepts an array
  const createQuestion = function(info) {
    return db.query(`
    INSERT INTO questions (quiz_id, question) VALUES ($1, $2) RETURNING *;`, info)
    .then(data => data.rows)
    .catch(err => err.message);
  }

  // Adds answers to db - accepts a nested array
  const createAnswer = function(info) {
    return db.query(`
    INSERT INTO answers (question_id, answer, is_correct) VALUES ($1, $2, $3) RETURNING *;`, info)
    .then(data => data.rows)
    .catch(err => err.message);
  };

  // Goes through all questions and answers, placing in correct db - accepts an object
  const addQuizContent = function(info) {
    let counter = 0; // counter used for referencing all answers against correct answer
    for (let question of info.questions) {
      createQuestion([info.id, question])
      .then(questionInfo => {
        for (let i = 1; i <= 4; i++) {
          if (Number(info.correct[counter]) === i) {
            createAnswer([questionInfo[0].id, info.answers[counter][i-1], true])
            .then(answer => {
              counter++;
              return answer;
            });
          } else {
            createAnswer([questionInfo[0].id, info.answers[counter][i-1], false])
            .then(answer => {
              counter++;
              return answer;
            });
          }
        }
      });
    }
  }

  // Returns a quiz object with the given id
  const getQuizWithId = function(id) {
    return db.query(`SELECT * FROM quizzes WHERE id = $1;`, [id])
      .then(data => data.rows[0])
      .catch(err => err.message);
  };

  // Returns a quiz object with the given url
  const getQuizWithUrl = (url) => {
    return db.query(`
      SELECT *
      FROM quizzes
      WHERE url = $1;
    `, [url])
      .then(data => data.rows[0])
      .catch(err => err.message);
  };

  // Returns all questions belonging to the given quiz, with the given type
  const getQuestions = (quiz_id, type) => {
    let query = ``;
    if (type === 'trivia') query += `SELECT * FROM trivia_questions WHERE quiz_id = $1 ORDER BY id;`;
    else query += `SELECT * FROM personality_questions WHERE quiz_id = $1 ORDER BY id;`;
    return db.query(query, [quiz_id])
      .then(data => data.rows)
      .catch(err => err.message);
  };

  // Returns all answers belonging to the given question, with the given type
  const getAnswers = (question_id, type) => {
    let query = ``;
    if (type === 'trivia') query += `SELECT * FROM trivia_answers WHERE question_id = $1 ORDER BY id;`;
    else query += `SELECT * FROM personality_answers WHERE question_id = $1 ORDER BY id;`;
    return db.query(query, [question_id])
      .then(data => data.rows)
      .catch(err => err.message);
  };

  // Returns all answers belonging to the given quiz, with the given type
  const getAnswersForQuiz = (quiz_id, type) => {
    let query = ``;
    if (type === 'trivia') query += `SELECT * FROM trivia_answers JOIN trivia_questions ON question_id = trivia_questions.id WHERE quiz_id = $1 ORDER BY id;`;
    else query += `SELECT * FROM personality_answers JOIN personality_questions ON question_id = personality_questions.id WHERE quiz_id = $1 ORDER BY id;`;
    return db.query(query, [quiz_id])
      .then(data => data.rows)
      .catch(err => err.message);
  };

  /**
   * Get all quiz categories
   * Returns an array of categories
   */
  const getCategories = () => {
    return db.query(`
      SELECT DISTINCT category
      FROM quizzes;
    `)
      .then(data => {
        const categories = [];
        data.rows.forEach((item) => categories.push(item.category));
        return categories;
      })
      .catch(err => err.message);
  };

  // returns an array of all quiz types
  const getTypes = () => {
    return db.query(`
    SELECT DISTINCT type
    FROM quizzes;
    `)
    .then(data => {
      const types = [];
      data.rows.forEach((item) => types.push(item.type));
      return types;
    })
    .catch(err => err.message);
  };
  
  // Calculates score based on the given array of answers chosen
  const getScore = function(answers) {
    let query = `SELECT COUNT(*) AS score FROM trivia_answers
    WHERE is_correct = true AND (`;
    const values = [];

    for (const answer in answers) {
      values.push(answers[answer]);
      if (values.length > 1) query += ` OR`
      query += ` id = $${values.length}`;
    }

    query += `);`

    return db.query(query, values)
      .then(data => data.rows[0])
      .catch(err => err.message);
  }

  // Calculates outcome based on the given array of answers chosen
  const getOutcome = function(answers) {
    let query = `SELECT outcome_id, COUNT(*) AS score FROM personality_answers
    WHERE (`;
    const values = [];

    for (const answer in answers) {
      values.push(answers[answer]);
      if (values.length > 1) query += ` OR`
      query += ` id = $${values.length}`;
    }

    query += `) GROUP BY outcome_id ORDER BY score DESC, outcome_id LIMIT 1;`

    return db.query(query, values)
      .then(data => data.rows[0].outcome_id)
      .catch(err => err.message);
  }

  // Returns an outcome object with the given id
  const getOutcomeWithId = function(outcome_id) {
    const query = `SELECT * FROM personality_outcomes WHERE id = $1;`;
    const values = [outcome_id];

    return db.query(query, values)
      .then(data => data.rows[0])
      .catch(err => err.message);
  }

  // Creates and returns a result for a trivia quiz with the given quiz, user, score and total possible score
  const createTriviaResult = function(quiz_id, user_id, score, total) {
    const dateString = Date.now();
    const timestamp = new Date(dateString);
    const date = timestamp.toDateString();
    let query = '';
    let values = [];
    if (user_id) {
      query += `INSERT INTO trivia_results (quiz_id, user_id, score, total, date_completed)
      VALUES ($1, $2, $3, $4, $5) RETURNING *;`;
      values = [quiz_id, user_id, score, total, date];
    }
    else {
      query += `INSERT INTO trivia_results (quiz_id, score, total, date_completed)
      VALUES ($1, $2, $3, $4) RETURNING *;`;
      values = [quiz_id, score, total, date];
    }

    return db.query(query, values)
      .then(data => data.rows[0])
      .catch(err => err.message);
  }

  // Creates and returns a result for a personality quiz with the given quiz, user, and outcome
  const createPersonalityResult = function(quiz_id, user_id, outcome_id) {
    const dateString = Date.now();
    const timestamp = new Date(dateString);
    const date = timestamp.toDateString();
    let query = '';
    let values = [];
    if (user_id) {
      query += `INSERT INTO personality_results (quiz_id, user_id, outcome_id, date_completed)
      VALUES ($1, $2, $3, $4) RETURNING *;`;
      values = [quiz_id, user_id, outcome_id, date];
    }
    else {
      query += `INSERT INTO personality_results (quiz_id, outcome_id, date_completed)
      VALUES ($1, $2, $3) RETURNING *;`;
      values = [quiz_id, outcome_id, date];
    }

    return db.query(query, values)
      .then(data => data.rows[0])
      .catch(err => err.message);
  }

  // Returns a result object with the given id from the table with the given type
  const getResult = function(result_id, type) {
    let query = `SELECT * FROM quizzes JOIN `;
    const values = [result_id];
    if (type === 'trivia') {
      query += `trivia_results ON quiz_id = quizzes.id WHERE trivia_results.id = $1;`
    }
    else {
      query += `personality_results ON quiz_id = quizzes.id WHERE personality_results.id = $1;`
    }
    return db.query(query, values)
      .then(data => data.rows[0])
      .catch(err => err.message);
  }

  // Returns all results that match the given quiz from the table with the given type
  const getAllResultsForQuiz = function(quiz_id, type) {
    let query = `SELECT * FROM `
    const values = [quiz_id];
    if (type === 'trivia') query += `trivia_results WHERE quiz_id = $1;`
    else query += `personality_results WHERE quiz_id = $1;`;
    return db.query(query, values)
      .then(data => data.rows)
      .catch(err => err.message);
  }

  // Returns the count of how many results belong to the given quiz
  const getNumResultsForQuiz = function(quiz_id) {
    const query = `SELECT COUNT(*) FROM trivia_results WHERE quiz_id = $1;`
    const values = [quiz_id];
    return db.query(query, values)
      .then(data => Number(data.rows[0].count))
      .catch(err => err.message);
  }

  // Returns the count of how many results that belong to the given quiz have a lower score than the given score
  const getNumScoresBeatenForQuiz = function(quiz_id, score) {
    const query = `SELECT COUNT(*) FROM trivia_results WHERE quiz_id = $1 AND score < $2;`
    const values = [quiz_id, score];
    return db.query(query, values)
      .then(data => Number(data.rows[0].count))
      .catch(err => err.message);
  }

  // Returns all results belonging to the given user
  const getResultsForUser = function(user_id) {
    const promises = [];
    const values = [user_id];
    let query = `SELECT * FROM quizzes JOIN trivia_results ON quiz_id = quizzes.id WHERE user_id = $1;`
    promises.push(db.query(query, values));
    query = `SELECT * FROM quizzes JOIN personality_results ON quiz_id = quizzes.id WHERE user_id = $1;`
    promises.push(db.query(query, values));
    return Promise.all(promises);
  }

  //Shuffles an array
  const shuffle = function(answers) {
    const shuffled = answers.slice(0);
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // Adds a favorite with the given user and quiz
  const addFavourite = function(user_id, quiz_id) {
    const query = `INSERT INTO favourites (user_id, quiz_id) VALUES ($1, $2) RETURNING *;`
    const values = [user_id, quiz_id];
    return db.query(query, values)
      .then(data => data.rows[0])
      .catch(err => err.message);
  }

  // Returns the favorite belonging to the given user and quiz
  const getFavourite = function(user_id, quiz_id) {
    const query = `SELECT * FROM favourites WHERE user_id = $1 AND quiz_id = $2;`
    const values = [user_id, quiz_id];
    return db.query(query, values)
      .then(data => data.rows[0])
      .catch(err => err.message);
  }

  // Deletes the favorite belonging to the given user and quiz
  const deleteFavourite = function(user_id, quiz_id) {
    const query = `DELETE FROM favourites WHERE user_id = $1 AND quiz_id = $2;`
    const values = [user_id, quiz_id];
    return db.query(query, values)
      .then()
      .catch(err => err.message);
  }

  // Adds a rating with the given user and quiz
  const addRating = function(user_id, quiz_id, rating) {
    const query = `INSERT INTO ratings (user_id, quiz_id, rating) VALUES ($1, $2, $3) RETURNING *;`
    const values = [user_id, quiz_id, rating];
    return db.query(query, values)
      .then(data => data.rows[0])
      .catch(err => err.message);
  }

  // Returns the rating belonging to the given user and quiz
  const getRating = function(user_id, quiz_id) {
    const query = `SELECT * FROM ratings WHERE user_id = $1 AND quiz_id = $2;`
    const values = [user_id, quiz_id];
    return db.query(query, values)
      .then(data => data.rows[0])
      .catch(err => err.message);
  }

  // Updates the rating belonging to the given user and quiz
  const updateRating = function(user_id, quiz_id, rating) {
    const query = `UPDATE ratings SET rating = $3 WHERE user_id = $1 AND quiz_id = $2 RETURNING *;`
    const values = [user_id, quiz_id, rating];
    return db.query(query, values)
      .then(data => data.rows[0])
      .catch(err => err.message);
  }

  return {
    getAllQuizzes,
    getPublicQuizzes,
    getQuizzesForUser,
    createNewQuiz,
    sort,
    createQuestion,
    createAnswer,
    addQuizContent,
    getQuizWithId,
    getQuizWithUrl,
    getQuestions,
    getAnswers,
    getAnswersForQuiz,
    getScore,
    getOutcome,
    getOutcomeWithId,
    createTriviaResult,
    createPersonalityResult,
    getResult,
    getAllResultsForQuiz,
    getNumResultsForQuiz,
    getNumScoresBeatenForQuiz,
    getResultsForUser,
    shuffle,
    getCategories,
    getTypes,
    addFavourite,
    deleteFavourite,
    getFavourite,
    getRating,
    addRating,
    updateRating,
  }
}
