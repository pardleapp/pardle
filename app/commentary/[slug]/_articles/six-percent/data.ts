// Numbers behind the article, kept out of the markup so the copy
// stays readable and the figures can be re-checked against the model.
export const LEADERBOARD = [
  { name: "Thriston Lawrence", tot: -13, tee: "13:10", rank: 30, exp: 69.23 },
  { name: "Ignacio Elvira Mijares", tot: -11, tee: "13:00", rank: 15, exp: 69.07 },
  { name: "Jeremy Paul", tot: -11, tee: "13:10", rank: 65, exp: 70.89 },
  { name: "Keita Nakajima", tot: -10, tee: "13:00", rank: 8, exp: 68.68 },
  { name: "Paul Casey", tot: -9, tee: "12:40", rank: 21, exp: 69.16 },
  { name: "Ashun Wu", tot: -9, tee: "12:50", rank: 43, exp: 69.74 },
  { name: "Rafa Cabrera Bello", tot: -9, tee: "12:50", rank: 54, exp: 70.12 },
  { name: "Eugenio Chacarra", tot: -8, tee: "12:30", rank: 5, exp: 68.55 },
  { name: "Thomas Detry", tot: -8, tee: "12:20", rank: 9, exp: 68.67 },
  { name: "Angel Ayora", tot: -8, tee: "12:30", rank: 13, exp: 68.82 },
] as const;

export const SENSITIVITY = [
  { basis: "0.06 - what the data says", p: 72.0, ev: +35.2 },
  { basis: "0.20 - what the market implies", p: 67.8, ev: +27.3 },
  { basis: "0.35 - deliberately generous", p: 62.9, ev: +18.1 },
] as const;
