/* eslint-disable */
/* Injected into the prototype's own page after it has booted (see prototype.ts).
   Reads each book and the figures the prototype itself computes — its own
   balancesFor/view and its own rendered reports — in integer cents, and puts
   the active book back as it was. It changes no book. Plain ES2017 on
   purpose: it is injected as a script, never bundled. Its free names (DB, S,
   UI, useBook, allTxns, view, balancesFor, fyStartMonth, reportPL, reportBS,
   reportTB, render, TABS, REPORTS) are the prototype's globals. */
(function () {
  "use strict";

  function cents(v) {
    var x = Number(v) || 0;
    var n = Math.round(Math.abs(x) * 100 + 1e-6);
    return x < 0 && n !== 0 ? -n : n;
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function monthEnd(y, m) {
    return y + "-" + pad(m) + "-" + pad(new Date(Date.UTC(y, m, 0)).getUTCDate());
  }
  function monthEndsBetween(first, last) {
    var out = [];
    var y = +first.slice(0, 4), m = +first.slice(5, 7);
    var ly = +last.slice(0, 4), lm = +last.slice(5, 7);
    while (y < ly || (y === ly && m <= lm)) {
      out.push(monthEnd(y, m));
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
    return out;
  }
  function fiscalYearsBetween(first, last, startMonth) {
    var y = +first.slice(0, 4);
    if (+first.slice(5, 7) < startMonth) y -= 1;
    var out = [];
    for (;;) {
      var from = y + "-" + pad(startMonth) + "-01";
      if (from > last) break;
      var endY = startMonth === 1 ? y : y + 1;
      var endM = startMonth === 1 ? 12 : startMonth - 1;
      out.push({ from: from, to: monthEnd(endY, endM) });
      y += 1;
    }
    return out;
  }
  function labelOf(cell) {
    var copy = cell.cloneNode(true);
    var subs = copy.querySelectorAll(".pct-sub");
    for (var i = 0; i < subs.length; i++) subs[i].parentNode.removeChild(subs[i]);
    return copy.textContent.replace(/\s+/g, " ").trim();
  }
  var AMOUNT = /^\(?[0-9,]+\.[0-9]{2}\)?$/;
  function amountOf(text) {
    var n = Math.round(parseFloat(text.replace(/[(),]/g, "")) * 100);
    return text.charAt(0) === "(" ? -n : n;
  }
  /* Label → the figures on that row, for every row of a rendered report. */
  function rowsOf(html) {
    var box = document.createElement("div");
    box.innerHTML = html;
    var out = {};
    var rows = box.querySelectorAll("tr");
    for (var r = 0; r < rows.length; r++) {
      var cells = rows[r].querySelectorAll("td");
      if (cells.length < 2) continue;
      var label = labelOf(cells[0]);
      var values = [];
      for (var c = 1; c < cells.length; c++) {
        var t = cells[c].textContent.replace(/\s+/g, "");
        if (AMOUNT.test(t)) values.push(amountOf(t));
      }
      if (values.length && !(label in out)) out[label] = values;
    }
    return out;
  }
  function first(rows, label) { return rows[label] ? rows[label][0] : null; }
  function orZero(v) { return v === null ? 0 : v; }

  function readBook(book) {
    useBook(book.id);
    UI.basis = "accrual";
    UI.compare = "none";
    UI.showPct = false;
    var all = allTxns();
    var names = {};
    (S.accounts || []).forEach(function (a) { names[a.name] = 1; });
    var entries = all.map(function (t) {
      return {
        id: String(t.id),
        date: t.date,
        description: String(t.payee || t.narration || ""),
        ref: String(t.ref || ""),
        closing: !!t.closing,
        postings: (t.postings || []).map(function (p) {
          names[p.account] = 1;
          return { account: p.account, cents: cents(p.amount) };
        })
      };
    });
    var dates = all.map(function (t) { return t.date; }).sort();
    var figures = { balances: {}, trialBalance: {}, profitAndLoss: {}, balanceSheet: {} };
    var monthEnds = dates.length ? monthEndsBetween(dates[0], dates[dates.length - 1]) : [];
    monthEnds.forEach(function (d) {
      var o = {};
      balancesFor(view("", d)).forEach(function (v, k) {
        var c = cents(v);
        if (c !== 0) o[k] = c;
      });
      figures.balances[d] = o;
    });
    var years = dates.length ? fiscalYearsBetween(dates[0], dates[dates.length - 1], fyStartMonth()) : [];
    years.forEach(function (y) {
      UI.from = y.from;
      UI.to = y.to;
      var pl = rowsOf(reportPL());
      figures.profitAndLoss[y.from + ".." + y.to] = {
        income: orZero(first(pl, "Total Income")),
        cogs: orZero(first(pl, "Total Cost of Goods Sold")),
        gross: first(pl, "Gross Profit"),
        opex: orZero(first(pl, "Total Expenses")),
        netOperating: first(pl, "Net Operating Income"),
        otherIncome: orZero(first(pl, "Total Other Income")),
        otherExpenses: orZero(first(pl, "Total Other Expenses")),
        netOther: orZero(first(pl, "Net Other Income")),
        net: first(pl, "Net Income")
      };
      var bs = rowsOf(reportBS());
      figures.balanceSheet[y.to] = {
        assets: first(bs, "Total Assets"),
        liabilities: first(bs, "Total Liabilities"),
        equity: first(bs, "Total Equity"),
        liabilitiesAndEquity: first(bs, "Total Liabilities and Equity")
      };
      var total = rowsOf(reportTB())["Total"] || [0, 0];
      figures.trialBalance[y.to] = { debit: total[0] || 0, credit: total[1] || 0 };
    });
    return {
      id: String(book.id),
      name: String((book.company && book.company.name) || "Book"),
      accounts: Object.keys(names).sort(),
      entries: entries,
      monthEnds: monthEnds,
      fiscalYears: years,
      figures: figures
    };
  }

  function bookById(id) {
    var book = DB.books.filter(function (b) { return String(b.id) === id; })[0];
    if (!book) throw new Error("no such book");
    return book;
  }

  window.__parity = {
    read: function () {
      var before = DB.activeId;
      try { return DB.books.map(readBook); }
      finally { useBook(before); }
    },
    books: function () {
      return DB.books.map(function (b) {
        return { id: String(b.id), name: String((b.company && b.company.name) || "Book") };
      });
    },
    tabs: function () { return TABS.map(function (t) { return { key: t.k, name: t.n }; }); },
    reports: function () { return REPORTS.map(function (r) { return { key: r.k, name: r.n }; }); },
    show: function (bookId, tab, report, theme) {
      useBook(bookById(bookId).id);
      document.documentElement.setAttribute("data-theme", theme);
      UI.tab = tab;
      if (report) UI.report = report;
      render();
      window.scrollTo(0, 0);
    }
  };
})();
