'use strict';
/*
 * So'kinishga qarshi filtr — chat xabarlari va o'yinchi ismlari uchun.
 * Haqoratli so'z topilsa, birinchi harfidan boshqasi yulduzcha bilan yashiriladi: "ahmoq" → "a****".
 * Filtr serverda ishlaydi, shuning uchun brauzerni o'zgartirib chetlab o'tib bo'lmaydi.
 *
 * Ro'yxat — so'z o'zaklari (boshlanishi). Qisqa va oddiy so'zlarga o'xshab qoladigan
 * o'zaklar ("it", "om") ataylab kiritilmagan, aks holda oddiy gaplar ham buzilib ketadi.
 */

// O'zbekcha (lotin) haqoratlar va so'kinishlar
const UZ = [
  'jalab', 'qanjiq', 'dalbayob', 'dolboyob', 'dalbayop', 'sikay', 'sikaman', 'sikib', 'sikdim', 'siktir',
  'qotaq', "qo'taq", 'qotoq', 'qutoq', 'onangni', 'onangga', 'padarlanat', 'padarla',
  'itvachcha', 'haromi', 'haromzoda', 'harom zoda', 'ahmoq', 'axmoq', 'tentak', 'iflos', 'nomard',
  'manjalaqi', 'gandon', 'pidaras', 'pidoras', 'pidor', 'yiban', 'yeban', 'jallob', 'xarom',
];
// Ruscha so'kinishlar (kirill va lotin yozuvida)
const RU = [
  'хуй', 'хуё', 'хуе', 'хуя', 'пизд', 'бля', 'ебан', 'ебат', 'ебал', 'ёб', 'еба', 'сука', 'суки', 'мудак', 'мудил',
  'гандон', 'пидор', 'пидар', 'шлюх', 'долбоеб', 'долбоёб', 'уеб', 'уёб', 'залуп', 'дебил', 'идиот', 'тварь',
  'xuy', 'xuyl', 'huy', 'pizd', 'blya', 'blyat', 'blyad', 'yeban', 'ebat', 'suka', 'mudak', 'debil', 'idiot',
];
// Inglizcha
const EN = ['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'dick', 'whore', 'slut', 'retard', 'motherf'];

// Yozuvdagi aldovlar: 0 → o, @ → a, $ → s ...
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };
const normalize = (s) => s.toLowerCase().replace(/[01345 7@$!]/g, (c) => LEET[c] || c).replace(/[ʻ‘’`]/g, "'");

const STEMS = [...UZ, ...RU, ...EN].map(normalize);

/** Bitta so'z haqoratlimi */
function isBad(word) {
  const w = normalize(word).replace(/[^\p{L}']/gu, '');
  if (w.length < 3) return false;
  return STEMS.some((stem) => w.startsWith(stem) || (stem.length >= 5 && w.includes(stem)));
}

/** Matndagi haqoratli so'zlarni yulduzcha bilan yashiradi */
function clean(text) {
  return String(text).replace(/[\p{L}\p{N}@$'ʻ‘’`]+/gu, (word) => (
    isBad(word) ? word[0] + '*'.repeat(Math.max(2, [...word].length - 1)) : word
  ));
}

module.exports = { clean, isBad };
