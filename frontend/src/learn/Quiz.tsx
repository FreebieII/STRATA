// "Check yourself": a few questions at the end of each chapter. Each answer is
// explained as soon as it is picked, right or wrong, and the score is kept in
// this browser so the Learn index can show how far you've got.

import { useEffect, useId, useState } from "react";

import { IconCritical, IconGood } from "../components/Icons";
import type { Question } from "./checks";
import { useLearnProgress } from "./progress";

export function Quiz({ chapterId, questions }: { chapterId: string; questions: Question[] }) {
  const { progress, recordQuiz } = useLearnProgress();
  const [picked, setPicked] = useState<Record<string, number>>({});
  // Bumped by "Try again", so every question starts afresh.
  const [round, setRound] = useState(0);
  const answered = questions.filter((q) => picked[q.id] !== undefined).length;
  const correct = questions.filter((q) => picked[q.id] === q.answer).length;
  const done = answered === questions.length;
  const previous = progress[chapterId]?.quiz;

  useEffect(() => {
    if (done) recordQuiz(chapterId, correct, questions.length);
  }, [done, correct, chapterId, questions.length, recordQuiz]);

  return (
    <section className="quiz" aria-labelledby="quiz">
      <h2 id="quiz">Check yourself</h2>
      <p className="muted">
        {questions.length} questions. Each answer is explained as soon as you pick one.
        {previous && !done ? ` Last time: ${previous.correct} of ${previous.total} right.` : ""}
      </p>
      <ol className="quiz__list">
        {questions.map((question, i) => (
          <QuizQuestion
            key={`${round}-${question.id}`}
            number={i + 1}
            question={question}
            picked={picked[question.id]}
            onPick={(option) => setPicked((current) => ({ ...current, [question.id]: option }))}
          />
        ))}
      </ol>
      {done ? (
        <div className="quiz__score" role="status">
          <p>
            <strong>
              {correct} of {questions.length} right.
            </strong>{" "}
            {correct === questions.length
              ? "Every one: well done."
              : "Read the explanations of the ones you missed, then try again if you like."}
          </p>
          <button
            type="button"
            className="button button--small"
            onClick={() => {
              setPicked({});
              setRound((r) => r + 1);
            }}
          >
            Try again
          </button>
        </div>
      ) : null}
    </section>
  );
}

function QuizQuestion({
  number,
  question,
  picked,
  onPick,
}: {
  number: number;
  question: Question;
  picked: number | undefined;
  onPick: (option: number) => void;
}) {
  const name = useId();
  const answered = picked !== undefined;
  const right = picked === question.answer;
  return (
    <li className="quiz__question">
      <fieldset disabled={answered}>
        <legend>
          <span className="quiz__number">{number}.</span> {question.prompt}
        </legend>
        {question.options.map((option, i) => {
          const state = !answered ? "" : i === question.answer ? " is-right" : i === picked ? " is-wrong" : "";
          return (
            <label key={option} className={`quiz__option${state}`}>
              <input type="radio" name={name} checked={picked === i} onChange={() => onPick(i)} />
              <span>{option}</span>
            </label>
          );
        })}
      </fieldset>
      <div aria-live="polite">
        {answered ? (
          <p className={`quiz__feedback quiz__feedback--${right ? "right" : "wrong"}`}>
            {right ? <IconGood size={16} /> : <IconCritical size={16} />}
            <span>
              <strong>{right ? "Right." : `Not quite: the answer is “${question.options[question.answer]}”.`}</strong>{" "}
              {question.why}
            </span>
          </p>
        ) : null}
      </div>
    </li>
  );
}
