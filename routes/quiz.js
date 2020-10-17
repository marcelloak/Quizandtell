/*
 * All routes for Quizzes are defined here
 * Since this file is loaded in server.js into /quiz,
 *   these routes are mounted onto /quiz
 * See: https://expressjs.com/en/guide/using-middleware.html#middleware.router
 */

const express = require('express');
const router  = express.Router();

module.exports = (helpers) => {
  router.get("/", (req, res) => {
    helpers.getAllQuizzes().then(info => res.json(info));
  });

  router.get("/:url", (req, res) => {
    let quizInfo = {}
    helpers.getQuizWithUrl(req.params.url)
      .then(quiz => {
        quizInfo.quiz = quiz;
        return helpers.getQuestions(quiz.id);
      })
      .then(questions => {
        quizInfo.questions = questions;
        return helpers.getAnswersForQuiz(quizInfo.quiz.id);
      })
      .then(answers => {
        quizInfo.answers = answers;
        res.json(quizInfo);
      });
  });

  return router;
};
