'use strict';

const express = require('express');
const { periodoDesde } = require('../lib/format');
const { facturacionDelMes } = require('../lib/billing');

const router = express.Router();

router.get('/', (req, res) => {
  const { anio, mes } = periodoDesde(req.query);
  const incluirPotenciales = req.query.potenciales === '1';
  const { filas, totales } = facturacionDelMes(anio, mes, { incluirPotenciales });

  res.render('facturacion/index', {
    titulo: 'Facturación',
    anio,
    mes,
    incluirPotenciales,
    filas,
    totales,
  });
});

module.exports = router;
