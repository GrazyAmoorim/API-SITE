const ORIGEM = {
  cep: '60740-020',
  logradouro: 'Rua Germano Franck',
  numero: '613',
  bairro: 'Parangaba',
  cidade: 'Fortaleza',
  uf: 'CE',
  lat: -3.7764,
  lon: -38.5608
};

const LIMITE_MOTO_KM = 40;

const form = document.getElementById('form-cep');
const campoCep = document.getElementById('cep');
const botao = document.getElementById('botao');
const mensagem = document.getElementById('status');
const resultado = document.getElementById('resultado');

let origemPromessa = null;
let ultimo = null;

const dinheiro = valor => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function numero(id) {
  return parseFloat(document.getElementById(id).value) || 0;
}

function mostrarStatus(texto, erro = false) {
  mensagem.textContent = texto;
  mensagem.classList.toggle('erro', erro);
  mensagem.hidden = !texto;
}

function mascararCep(valor) {
  const digitos = valor.replace(/\D/g, '').slice(0, 8);
  return digitos.length > 5 ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : digitos;
}

async function buscarJson(url) {
  const resposta = await fetch(url);
  if (!resposta.ok) throw new Error(`Falha na requisição (${resposta.status})`);
  return resposta.json();
}

async function consultarCep(cep) {
  const dados = await buscarJson(`https://viacep.com.br/ws/${cep}/json/`);
  if (dados.erro) throw new Error('CEP não encontrado. Confira os números e tente de novo.');
  return dados;
}

async function geocodificar(consultas) {
  for (const consulta of consultas) {
    const parametros = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'br', ...consulta.parametros });
    try {
      const lista = await buscarJson(`https://nominatim.openstreetmap.org/search?${parametros}`);
      if (lista.length) {
        return { lat: parseFloat(lista[0].lat), lon: parseFloat(lista[0].lon), precisao: consulta.precisao };
      }
    } catch {}
  }
  return null;
}

function consultasDoEndereco(e) {
  const consultas = [];
  if (e.logradouro) {
    consultas.push({
      precisao: 'Localização aproximada pela rua',
      parametros: { q: `${e.logradouro}, ${e.bairro}, ${e.localidade}, ${e.uf}, Brasil` }
    });
  }
  consultas.push({
    precisao: 'Localização aproximada pelo CEP',
    parametros: { postalcode: e.cep, country: 'Brazil' }
  });
  consultas.push({
    precisao: 'Localização aproximada pelo bairro',
    parametros: { q: `${e.bairro || ''}, ${e.localidade}, ${e.uf}, Brasil` }
  });
  return consultas;
}

function obterOrigem() {
  if (!origemPromessa) {
    origemPromessa = geocodificar([{
      precisao: 'origem',
      parametros: { q: `${ORIGEM.logradouro}, ${ORIGEM.numero}, ${ORIGEM.bairro}, ${ORIGEM.cidade}, ${ORIGEM.uf}, Brasil` }
    }]).then(ponto => ponto || { lat: ORIGEM.lat, lon: ORIGEM.lon });
  }
  return origemPromessa;
}

function distanciaReta(a, b) {
  const rad = g => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

async function calcularRota(origem, destino) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${origem.lon},${origem.lat};${destino.lon},${destino.lat}?overview=false`;
    const dados = await buscarJson(url);
    const rota = dados.routes[0];
    return { km: rota.distance / 1000, minutos: rota.duration / 60, estimada: false };
  } catch {
    const km = distanciaReta(origem, destino) * 1.3;
    return { km, minutos: (km / 25) * 60, estimada: true };
  }
}

function calcularPrecos(rota) {
  const uber = Math.max(
    numero('t-uber-minimo'),
    numero('t-uber-base') + rota.km * numero('t-uber-km') + rota.minutos * numero('t-uber-min')
  );
  const tabela = numero('t-frete-base') + rota.km * numero('t-frete-km');
  const final = Math.max(uber, tabela);
  return { uber, tabela, final, regra: final === uber ? 'Baseado no Uber Moto' : 'Baseado na tabela por distância' };
}

function exibir(endereco, ponto, rota, precos) {
  const partes = [endereco.logradouro, endereco.bairro, `${endereco.localidade}/${endereco.uf}`].filter(Boolean);
  document.getElementById('r-endereco').textContent = `${partes.join(' · ')} · ${endereco.cep}`;

  let precisao = ponto.precisao;
  if (rota.estimada) precisao += ' · rota estimada em linha reta (serviço de rotas indisponível)';
  const distanciaReal = distanciaReta({ lat: ORIGEM.lat, lon: ORIGEM.lon }, ponto);
  if (rota.km > LIMITE_MOTO_KM || distanciaReal > LIMITE_MOTO_KM) precisao += ' · distância acima do alcance usual de moto';
  document.getElementById('r-precisao').textContent = precisao;

  document.getElementById('r-distancia').textContent = `${rota.km.toFixed(1).replace('.', ',')} km`;
  document.getElementById('r-tempo').textContent = `Cerca de ${Math.max(1, Math.round(rota.minutos))} min`;
  document.getElementById('r-uber').textContent = dinheiro(precos.uber);
  document.getElementById('r-tabela').textContent = dinheiro(precos.tabela);
  document.getElementById('r-formula-tabela').textContent =
    `${dinheiro(numero('t-frete-base'))} + ${dinheiro(numero('t-frete-km'))}/km`;
  document.getElementById('r-frete').textContent = dinheiro(precos.final);
  document.getElementById('r-regra').textContent = precos.regra;

  resultado.hidden = false;
}

campoCep.addEventListener('input', () => {
  campoCep.value = mascararCep(campoCep.value);
});

form.addEventListener('submit', async evento => {
  evento.preventDefault();

  const cep = campoCep.value.replace(/\D/g, '');
  if (cep.length !== 8) {
    mostrarStatus('Digite um CEP com 8 números.', true);
    return;
  }

  botao.disabled = true;
  resultado.hidden = true;

  try {
    mostrarStatus('Buscando o endereço...');
    const endereco = await consultarCep(cep);

    mostrarStatus('Localizando no mapa...');
    const origem = await obterOrigem();
    const ponto = await geocodificar(consultasDoEndereco(endereco));
    if (!ponto) throw new Error('Não foi possível localizar esse endereço no mapa.');

    mostrarStatus('Calculando a rota...');
    const rota = await calcularRota(origem, ponto);
    const precos = calcularPrecos(rota);

    ultimo = { endereco, ponto, rota };
    exibir(endereco, ponto, rota, precos);
    mostrarStatus('');
  } catch (erro) {
    mostrarStatus(erro.message || 'Algo deu errado. Tente novamente.', true);
  } finally {
    botao.disabled = false;
  }
});

document.querySelectorAll('.tarifas input').forEach(campo => {
  campo.addEventListener('input', () => {
    if (ultimo) exibir(ultimo.endereco, ultimo.ponto, ultimo.rota, calcularPrecos(ultimo.rota));
  });
});