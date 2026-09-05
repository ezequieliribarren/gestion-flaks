'use strict';

const express = require('express');
const { periodoDesde } = require('../lib/format');
const { cajaDelMes } = require('../lib/billing');

const router = express.Router();

router.get('/', (req, res) => {
  const { anio, mes } = periodoDesde(req.query);
  const incluirPotenciales = req.query.potenciales === '1';
  const caja = cajaDelMes(anio, mes, { incluirPotenciales });
  res.render('caja/index', { titulo: 'Caja', anio, mes, incluirPotenciales, caja });
});

module.exports = router;
