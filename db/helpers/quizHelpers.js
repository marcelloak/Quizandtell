const { query } = require("express");

module.exports = (db) => {
  const limit = 12;

   /**
   * Gets listed quizzes given filter and sort options
   * @param {{filterType:string, filterName:string, sortName:string, sortOrder: string}} options
   */
  const getPublicQuizzes = (options) => {

    const { filterType, filterName, sortName, sortOrder } = options;
    const queryParams = [];
    let orderCol;
    let queryString = "";

    // sort based on selected option
    if (sortName === "popular") {
      // join with popularity table (count of quiz results)
      queryString += `
        SELECT quizzes.*, popular_counts.*
        FROM quizzes JOIN(
          SELECT counts.id, SUM(counts.count) AS total_count
          FROM (SELECT quizzes.id, COUNT(quiz_id) AS count
            FROM quizzes
              LEFT JOIN personality_results ON quizzes.id = quiz_id
              GROUP BY quizzes.id
              UNION SELECT quizzes.id, COUNT(quiz_id) AS count
                FROM quizzes
                LEFT JOIN trivia_results ON quizzes.id = quiz_id
              GROUP BY quizzes.id) as counts
            GROUP BY counts.id
          ) AS popular_counts ON popular_counts.id = quizzes.id
      `;

      orderCol = "total_count";

    } else if (sortName === "rating") {
      // join with ratings table (average of quiz ratings)
      queryString += `
        SELECT quizzes.*, rating_counts.*
        FROM quizzes JOIN(
          SELECT quizzes.id, CASE
            WHEN AVG(rating) IS NULL
            THEN 0
            ELSE AVG(rating) END
            AS avg_rating
          FROM quizzes
          LEFT JOIN ratings ON quiz_id = quizzes.id
          GROUP BY quizzes.id
          ) AS rating_counts ON rating_counts.id = quizzes.id
        `;

      orderCol = "avg_rating";

    } else if (sortName === "favourite") {
      // join with favourites table (count of quiz favourites)
      queryString += `
        SELECT quizzes.*, favourite_count.*
        FROM quizzes JOIN(
          SELECT quizzes.id, COUNT(quiz_id) AS total_count
          FROM quizzes
            LEFT JOIN favourites on quiz_id = quizzes.id
          GROUP BY quizzes.id
          ) AS favourite_count ON favourite_count.id = quizzes.id
        `;

      orderCol = "total_count";

    // default sort: by create date
    } else {
      queryString += `
        SELECT quizzes.* FROM quizzes
      `;
      orderCol = "date_created";
    }

    // choose only publicly listed quizzes
    queryString += `
      WHERE listed = true
    `;

    // filter based on selected option (no filter is All is selected)
    if (filterName !== "All") {
      queryParams.push(filterName);
      if (filterType === "type") {
        queryString += `
          AND type = $${queryParams.length}
        `;
      } else if (filterType === "category") {
        queryString += `
          AND category = $${queryParams.length}
        `;
      }
    }

    // set sort order based on selection
    if (sortOrder === "desc") {
      queryString += `
        ORDER BY ${orderCol} DESC
      `;
    } else {
      queryString += `
        ORDER BY ${orderCol} ASC
      `;
    }

    if (options.offset !== undefined) {
      if (Number(options.offset) === 0) queryParams.push(options.offset);
      else queryParams.push(Number(options.offset) + 1);
      queryString += `LIMIT ${limit} OFFSET $${queryParams.length}`
    }

    return db.query(queryString, queryParams)
      .then(data => data.rows)
      .catch(err => err.message);
  };

  // given userid, returns quizzes that user created
  const getQuizzesForUser = (id, offset) => {
    const params = [id];
    let query = `
      SELECT * FROM quizzes
      JOIN users ON users.id = creator_id
      WHERE creator_id = $1
      ORDER BY date_created DESC
    `
    if (offset !== undefined) {
      if (Number(offset) === 0) params.push(offset);
      else params.push(Number(offset) + 1);
      query += `LIMIT ${limit} OFFSET $2`;
    }
    return db.query(query, params)
      .then(data => data.rows)
      .catch(err => err.message);
  };

  // Check each created URL on creation to make sure it has not been used before
  const uniqueURLs = [];
  db.query(`SELECT url FROM quizzes;`)
    .then(data => uniqueURLs.push(...data.rows.map(url => url.url)))

  const createURL = () => {
    const createdURL = Math.random().toString(20).substr(2, 8);
    if (!uniqueURLs.includes(createdURL)) {
      uniqueURLs.push(createdURL);
      return createdURL
    } else {
      return createURL();
    }
  }

  // Adds quiz to db - accepts user_id string, and an object
  const createNewQuiz = (id, info) => {
    let date = new Date();
    date = date.toISOString();
    const createdURL = createURL();
    return db.query(`
    INSERT INTO quizzes (creator_id, title, photo, listed, url, category, date_created, type, description)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *;`, [id, info.title, info.thumbnail, info.listed, createdURL, info.category, date, info.type, info.quizDescription || null])
    .then(data => data.rows[0])
    .catch(err => err.message);
  };

  // Sorts form data for trivia quiz into questions, answers, and correct(s) - accepts and returns an object
  const triviaSort = function(id, info) {
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
  };

  // Adds question to trivia db - accepts an array
  const createTriviaQuestion = function(info) {
    return db.query(`
    INSERT INTO trivia_questions (quiz_id, question)
    VALUES ($1, $2)
    RETURNING *;`, info)
    .then(data => data.rows)
    .catch(err => err.message);
  };

  // Adds answers to trivia db - accepts a nested array
  const createTriviaAnswer = function(info) {
    return db.query(`
    INSERT INTO trivia_answers (question_id, answer, is_correct)
    VALUES ($1, $2, $3)
    RETURNING *;`, info)
    .then(data => data.rows)
    .catch(err => err.message);
  };

  // Goes through all questions and answers, placing in correct trivia db - accepts an object (returned from triviaSort())
  const addTriviaQuizContent = function(info) {
    let counter = 0; // counter used for referencing all answers against correct answer
    let questionCounter = -1;
    for (let question of info.questions) {
      createTriviaQuestion([info.id, question])
      .then(questionInfo => {
        questionCounter++;
        for (let i = 1; i <= 4; i++) {
          if (Number(info.correct[counter]) === i) {
            createTriviaAnswer([questionInfo[0].id, info.answers[questionCounter][i-1], true])
            .then(answer => {
              counter++;
              return answer;
            });
          } else {
            createTriviaAnswer([questionInfo[0].id, info.answers[questionCounter][i-1], false])
            .then(answer => {
              return answer;
            });
          }
        }
      });
    }
  };

  // Sorts form data for personality quiz into questions, answers, and outcomes - accepts and returns an object
  const personalitySort = function(id, info) {
    const outcomeCount = info.outcomeCount;
    const questionCount = info.questionCount;
    const questions = [];
    const outcomes = {};
    const answers = [];
    const pointers = [];
    for (let i = 1; i <= outcomeCount; i++) {
      outcomes[info[`outcome${i}`]] = [info[`photo${i}` || null], info[`description${i}`] || null];
    }
      for (let i = 1; i <= questionCount; i++) {
      questions.push(info[`question${i}`]);
      answers.push([info[`a${i}`], info[`b${i}`], info[`c${i}`], info[`d${i}`]]);
      pointers.push([info[`a${i}_pointer`], info[`b${i}_pointer`], info[`c${i}_pointer`], info[`d${i}_pointer`]]);
    }
    return { questions, outcomes, answers, pointers, id }
  }

  // Adds outcomes to personality db - accepts an array
  const createOutcomes = function(info) {
    return db.query(`
      INSERT INTO personality_outcomes (quiz_id, title, photo, description)
      VALUES ($1, $2, $3, $4)
      RETURNING *;`, info)
    .then(data => data.rows)
    .catch(err => err.message);
  }

  // Adds question to personality db - accepts an array
  const createPersonalityQuestion = function(info) {
    return db.query(`
    INSERT INTO personality_questions (quiz_id, question)
    VALUES ($1, $2) RETURNING *;`, info)
    .then(data => data.rows)
    .catch(err => err.message);
  }

  // Adds answers to personality db - accepts an array
  const createPersonalityAnswer = function(info) {
    return db.query(`
    INSERT INTO personality_answers (question_id, outcome_id, answer)
    VALUES ($1, $2, $3) RETURNING *;`, info)
    .then(data => data.rows)
    .catch(err => err.message);
  };

  // Goes through all questions and answers, placing in correct personality db - accepts an object (returned from personalitySort())
  const addPersonalityQuizContent = function(info) {
    let outcomeCounter = 1; // starts at 1 because grabbing looking for # of outcomes, not index
    let questionIndex = -1;
    let outcomePairs = {};
    for (let outcome in info.outcomes) {
      let outcomeInfo = [info.id, outcome, info.outcomes[outcome][0], info.outcomes[outcome][1]];
      createOutcomes(outcomeInfo)
      .then(outcomes => {
        outcomePairs[outcomes[0].title] = outcomes[0].id;
        // Wait for outcomes to finish before starting questions
        if (outcomeCounter === Object.keys(info.outcomes).length) {
          for (let question of info.questions) {
            createPersonalityQuestion([info.id, question])
            .then(questionInfo => {
              questionIndex++;
              for (let i = 1; i <= 4; i++) {
                createPersonalityAnswer([questionInfo[0].id, outcomePairs[info.pointers[questionIndex][i-1]], info.answers[questionIndex][i-1]])
                .then(answer => {
                  return answer;
                });
              }
            });
          }
        } else {
          outcomeCounter++;
        }
      });
    }
  }

  // Returns a quiz object with the given id
  const getQuizWithId = function(id) {
    return db.query(`
      SELECT *
      FROM quizzes
      WHERE id = $1;
    `, [id])
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
    if (type === 'trivia') query += `
      SELECT *
      FROM trivia_questions
      WHERE quiz_id = $1
      ORDER BY id;
    `;
    else query += `
      SELECT *
      FROM personality_questions
      WHERE quiz_id = $1
      ORDER BY id;
    `;
    return db.query(query, [quiz_id])
      .then(data => data.rows)
      .catch(err => err.message);
  };

  // Returns all answers belonging to the given question, with the given type
  const getAnswers = (question_id, type) => {
    let query = ``;
    if (type === 'trivia') query += `
      SELECT *
      FROM trivia_answers
      WHERE question_id = $1
      ORDER BY id;
    `;
    else query += `
      SELECT *
      FROM personality_answers
      WHERE question_id = $1
      ORDER BY id;
    `;
    return db.query(query, [question_id])
      .then(data => data.rows)
      .catch(err => err.message);
  };

  // Returns all answers belonging to the given quiz, with the given type
  const getAnswersForQuiz = (quiz_id, type) => {
    let query = ``;
    if (type === 'trivia') query += `
      SELECT *
      FROM trivia_answers
      JOIN trivia_questions ON question_id = trivia_questions.id
      WHERE quiz_id = $1
      ORDER BY id;
    `;
    else query += `
      SELECT *
      FROM personality_answers
      JOIN personality_questions ON question_id = personality_questions.id
      WHERE quiz_id = $1
      ORDER BY id;
    `;
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
    let query = `
      SELECT COUNT(*) AS score
      FROM trivia_answers
      WHERE is_correct = true AND (
    `;
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
  };

  // Calculates outcome based on the given array of answers chosen
  const getOutcome = function(answers) {
    let query = `
      SELECT outcome_id, COUNT(*) AS score
      FROM personality_answers
      WHERE (
    `;
    const values = [];

    for (const answer in answers) {
      values.push(answers[answer]);
      if (values.length > 1) query += ` OR`
      query += ` id = $${values.length}`;
    }

    query += `
      ) GROUP BY outcome_id
      ORDER BY score DESC, outcome_id
      LIMIT 1;
    `

    return db.query(query, values)
      .then(data => data.rows[0].outcome_id)
      .catch(err => err.message);
  };

  // Returns an outcome object with the given id
  const getOutcomeWithId = function(outcome_id) {
    const query = `
      SELECT *
      FROM personality_outcomes
      WHERE id = $1;
    `;
    const values = [outcome_id];

    return db.query(query, values)
      .then(data => data.rows[0])
      .catch(err => err.message);
  };

  // Creates and returns a result for a trivia quiz with the given quiz, user, score and total possible score
  const createTriviaResult = function(quiz_id, user_id, score) {
    let date = new Date();
    date = date.toISOString();
    let query = '';
    let values = [];
    if (user_id) {
      query += `
        INSERT INTO trivia_results (quiz_id, user_id, score, date_completed)
        VALUES ($1, $2, $3, $4)
        RETURNING *;
      `;
      values = [quiz_id, user_id, score, date];
    }
    else {
      query += `
        INSERT INTO trivia_results (quiz_id, score, date_completed)
        VALUES ($1, $2, $3)
        RETURNING *;
      `;
      values = [quiz_id, score, date];
    }

    return db.query(query, values)
      .then(data => data.rows[0])
      .catch(err => err.message);
  };

  // Creates and returns a result for a personality quiz with the given quiz, user, and outcome
  const createPersonalityResult = function(quiz_id, user_id, outcome_id) {
    let date = new Date();
    date = date.toISOString();
    let query = '';
    let values = [];
    if (user_id) {
      query += `
        INSERT INTO personality_results (quiz_id, user_id, outcome_id, date_completed)
        VALUES ($1, $2, $3, $4)
        RETURNING *;
      `;
      values = [quiz_id, user_id, outcome_id, date];
    }
    else {
      query += `
        INSERT INTO personality_results (quiz_id, outcome_id, date_completed)
        VALUES ($1, $2, $3)
        RETURNING *;
      `;
      values = [quiz_id, outcome_id, date];
    }

    return db.query(query, values)
      .then(data => data.rows[0])
      .catch(err => err.message);
  };

  // Returns a result object with the given id from the table with the given type
  const getResult = function(result_id, type) {
    let query = `
      SELECT *
      FROM quizzes
    `;
    const values = [result_id];
    if (type === 'trivia') {
      query += `
        JOIN trivia_results ON quiz_id = quizzes.id
        WHERE trivia_results.id = $1;
      `
    }
    else {
      query += `
        JOIN personality_results ON quiz_id = quizzes.id
        WHERE personality_results.id = $1;
      `
    }
    return db.query(query, values)
      .then(data => data.rows[0])
      .catch(err => err.message);
  };

  // Returns all results that match the given quiz from the table with the given type
  const getAllResultsForQuiz = function(quiz_id, type) {
    let query = `
      SELECT *
    `
    const values = [quiz_id];
    if (type === 'trivia') query += `
      FROM trivia_results
      WHERE quiz_id = $1;
    `
    else query += `
      FROM personality_results
      WHERE quiz_id = $1;
    `;
    return db.query(query, values)
      .then(data => data.rows)
      .catch(err => err.message);
  };

  // Returns the count of how many results belong to the given quiz
  const getNumResultsForQuiz = function(quiz_id) {
    const query = `
      SELECT COUNT(*)
      FROM trivia_results
      WHERE quiz_id = $1;
    `
    const values = [quiz_id];
    return db.query(query, values)
      .then(data => Number(data.rows[0].count))
      .catch(err => err.message);
  };

  // Returns the count of how many results that belong to the given quiz have a lower score than the given score
  const getNumScoresBeatenForQuiz = function(quiz_id, score) {
    const query = `
      SELECT COUNT(*)
      FROM trivia_results
      WHERE quiz_id = $1 AND score < $2;
    `
    const values = [quiz_id, score];
    return db.query(query, values)
      .then(data => Number(data.rows[0].count))
      .catch(err => err.message);
  };

  // Returns all results belonging to the given user
  const getResultsForUser = function(user_id, offset) {
    let query = `
    SELECT trivia_results.id, user_id, quiz_id, score, date_completed, quizzes.*
    FROM quizzes
    JOIN trivia_results ON quiz_id = quizzes.id
    WHERE user_id = $1
    UNION SELECT personality_results.id, user_id, quiz_id, outcome_id, date_completed, quizzes.*
    FROM quizzes
    JOIN personality_results ON quiz_id = quizzes.id
    WHERE user_id = $1
    ORDER BY date_completed DESC
    `
    const values = [user_id];

    if (offset) {
      if (Number(offset) === 0) values.push(offset);
      else values.push(Number(offset) + 1);
      query += `LIMIT 12 OFFSET $2`;
    }

    query += `;`

    return db.query(query, values)
      .then(data => data.rows)
      .catch(err => err.message);
  };

  //Shuffles an array
  const shuffle = function(answers) {
    const shuffled = answers.slice(0);
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  // Adds a favorite with the given user and quiz
  const addFavourite = function(user_id, quiz_id) {
    const query = `
      INSERT INTO favourites (user_id, quiz_id)
      VALUES ($1, $2)
      RETURNING *;
    `
    const values = [user_id, quiz_id];
    return db.query(query, values)
      .then(data => data.rows[0])
      .catch(err => err.message);
  };

  // Returns the favorite belonging to the given user and quiz
  const getFavourite = function(user_id, quiz_id) {
    const query = `
      SELECT *
      FROM favourites
      WHERE user_id = $1 AND quiz_id = $2;
    `
    const values = [user_id, quiz_id];
    return db.query(query, values)
      .then(data => data.rows[0])
      .catch(err => err.message);
  };

  // Returns all favorites belonging to the given user
  const getFavourites = function(user_id, offset) {
    const values = [user_id];
    let query = `
      SELECT *
      FROM quizzes
      JOIN favourites ON quizzes.id = quiz_id
      WHERE user_id = $1
      ORDER BY favourites.id DESC
    `
    if (offset !== undefined) {
      if (Number(offset) === 0) values.push(offset);
      else values.push(Number(offset) + 1);
      query += `LIMIT ${limit} OFFSET $2`
    }
    return db.query(query, values)
      .then(data => data.rows)
      .catch(err => err.message);
  };

  // Deletes the favorite belonging to the given user and quiz
  const deleteFavourite = function(user_id, quiz_id) {
    const query = `
      DELETE FROM favourites
      WHERE user_id = $1 AND quiz_id = $2;
    `
    const values = [user_id, quiz_id];
    return db.query(query, values)
      .then()
      .catch(err => err.message);
  };

  // Adds a rating with the given user and quiz
  const addRating = function(user_id, quiz_id, rating) {
    const query = `
      INSERT INTO ratings (user_id, quiz_id, rating)
      VALUES ($1, $2, $3)
      RETURNING *;
    `
    const values = [user_id, quiz_id, rating];
    return db.query(query, values)
      .then(data => data.rows[0])
      .catch(err => err.message);
  };

  // Returns the rating belonging to the given user and quiz
  const getRating = function(user_id, quiz_id) {
    const query = `
      SELECT *
      FROM ratings
      WHERE user_id = $1 AND quiz_id = $2;
    `
    const values = [user_id, quiz_id];
    return db.query(query, values)
      .then(data => data.rows[0])
      .catch(err => err.message);
  };

  // Updates the rating belonging to the given user and quiz
  const updateRating = function(user_id, quiz_id, rating) {
    const query = `
      UPDATE ratings
      SET rating = $3
      WHERE user_id = $1 AND quiz_id = $2
      RETURNING *;
    `
    const values = [user_id, quiz_id, rating];
    return db.query(query, values)
      .then(data => data.rows[0])
      .catch(err => err.message);
  };

  // Returns quizzes in order of most favourites
  const getMostFavourited = function() {
    const query = `
      SELECT quizzes.id, COUNT(quiz_id) AS count
      FROM quizzes
      LEFT JOIN favourites on quiz_id = quizzes.id
      GROUP BY quizzes.id
      ORDER BY count DESC, quizzes.id;
    `
    return db.query(query)
      .then(data => data.rows)
      .catch(err => err.message);
  };

  // Returns quizzes in order of most results
  const getMostPopular = function() {
    const query = `
      SELECT counts.id, SUM(counts.count) AS total_count
      FROM (SELECT quizzes.id, COUNT(quiz_id) AS count
        FROM quizzes
        LEFT JOIN personality_results ON quizzes.id = quiz_id
        GROUP BY quizzes.id
          UNION SELECT quizzes.id, COUNT(quiz_id) AS count
          FROM quizzes
          LEFT JOIN trivia_results ON quizzes.id = quiz_id
          GROUP BY quizzes.id) as counts
      GROUP BY counts.id
      ORDER BY total_count DESC, counts.id;
    `
    return db.query(query)
      .then(data => data.rows)
      .catch(err => err.message);
  };

  // Returns quizzes in order of best average rating
  const getBestRated = function() {
    const query = `
      SELECT quizzes.id, CASE
        WHEN AVG(rating) IS NULL
        THEN 0
        ELSE AVG(rating) END
        AS avg_rating
      FROM quizzes
      LEFT JOIN ratings on quiz_id = quizzes.id
      GROUP BY quizzes.id
      ORDER BY avg_rating DESC, quizzes.id;
    `
    return db.query(query)
      .then(data => data.rows)
      .catch(err => err.message);
  };

  return {
    getPublicQuizzes,
    getQuizzesForUser,
    uniqueURLs,
    createNewQuiz,
    triviaSort,
    personalitySort,
    createOutcomes,
    createTriviaQuestion,
    createTriviaAnswer,
    createPersonalityQuestion,
    createPersonalityAnswer,
    addTriviaQuizContent,
    addPersonalityQuizContent,
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
    getFavourites,
    getRating,
    addRating,
    updateRating,
    getMostFavourited,
    getMostPopular,
    getBestRated,
  }
}
