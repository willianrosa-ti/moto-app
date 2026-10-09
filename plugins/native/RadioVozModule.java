package com.millin.motorista.overlay;

import android.Manifest;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.MediaCodec;
import android.media.MediaCodecList;
import android.media.MediaFormat;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Process;
import android.os.SystemClock;
import android.util.Base64;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.ShortBuffer;
import java.util.ArrayDeque;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

// Rádio pelo servidor (estilo Zello). Grava a voz em pedaços de ~200 ms comprimidos em Opus (G.711 μ-law nos
// aparelhos sem codificador Opus, Android 9 ou anterior) e toca na hora os pedaços que chegam do servidor.
// O formato é o mesmo do navegador e do painel (services/radio/formatoVoz.js).
public class RadioVozModule extends ReactContextBaseJavaModule {
    private static final int TAXA_SAIDA = 48000, TAXA_PCMU = 8000, PEDACO_MS = 200, RESERVA_MS = 250;
    private static final Object NADA = new Object();

    private final ReactApplicationContext contexto;
    private Captura captura;
    private Reproducao reproducao;
    private int fala;

    public RadioVozModule(ReactApplicationContext contexto) {
        super(contexto);
        this.contexto = contexto;
    }

    @Override
    public String getName() {
        return "RadioVoz";
    }

    // modo: "parado" (fecha o microfone), "pronto" (microfone aberto, sem enviar) ou "enviando".
    // Ao deixar de enviar, devolve o último pedaço da fala, para ele sair antes de liberar a vez.
    @ReactMethod
    public void microfone(String modo, Promise promise) {
        try {
            if ("parado".equals(modo)) {
                Captura atual = captura;
                captura = null;
                promise.resolve(atual == null ? null : atual.encerrar());
                return;
            }
            if (contexto.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                promise.reject("E_RADIO_MIC", "Permita o microfone para falar no rádio.");
                return;
            }
            if (captura == null || !captura.isAlive()) {
                Captura nova = new Captura();
                nova.abrir();
                captura = nova;
            }
            if ("enviando".equals(modo)) {
                if (!captura.enviando()) captura.enviar(++fala);
                promise.resolve(null);
            } else {
                promise.resolve(captura.pararEnvio());
            }
        } catch (Exception erro) {
            String mensagem = erro.getMessage() == null ? "Não foi possível abrir o microfone do rádio." : erro.getMessage();
            promise.reject("E_RADIO_MIC", mensagem, erro);
        }
    }

    @ReactMethod
    public void tocar(int falaRecebida, String codec, String dados) {
        byte[] bytes;
        try {
            bytes = Base64.decode(dados, Base64.DEFAULT);
        } catch (Exception erro) {
            return;
        }
        if (reproducao == null || !reproducao.isAlive()) {
            reproducao = new Reproducao();
            reproducao.start();
        }
        reproducao.tocar(falaRecebida, codec, bytes);
    }

    // Quem falava soltou o botão: o que estiver guardado toca na hora, sem esperar a reserva.
    @ReactMethod
    public void fimFala() {
        if (reproducao != null) reproducao.fimFala();
    }

    @ReactMethod
    public void parar() {
        Captura atual = captura;
        captura = null;
        if (atual != null) atual.descartar();
        Reproducao r = reproducao;
        reproducao = null;
        if (r != null) r.encerrar();
    }

    @Override
    public void invalidate() {
        parar();
        super.invalidate();
    }

    private void emitir(int falaAtual, String codec, byte[] dados) {
        if (dados.length == 0 || !contexto.hasActiveReactInstance()) return;
        contexto.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
            .emit("RadioVozPedaco", pedaco(falaAtual, codec, dados));
    }

    private static WritableMap pedaco(int falaAtual, String codec, byte[] dados) {
        WritableMap mapa = Arguments.createMap();
        mapa.putInt("fala", falaAtual);
        mapa.putString("codec", codec);
        mapa.putString("dados", Base64.encodeToString(dados, Base64.NO_WRAP));
        return mapa;
    }

    private static Object fechar(Codificador codificador, int falaAtual) {
        if (codificador == null) return NADA;
        byte[] resto = codificador.fechar();
        return resto.length == 0 ? NADA : pedaco(falaAtual, codificador.nome(), resto);
    }

    // Opus pelo MediaCodec existe a partir do Android 10; antes disso a voz vai em μ-law.
    private static String codificadorOpus(int taxa) {
        if (Build.VERSION.SDK_INT < 29 || (taxa != 48000 && taxa != 16000 && taxa != 8000)) return null;
        try {
            MediaFormat formato = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_OPUS, taxa, 1);
            formato.setInteger(MediaFormat.KEY_BIT_RATE, 16000);
            return new MediaCodecList(MediaCodecList.REGULAR_CODECS).findEncoderForFormat(formato);
        } catch (Exception erro) {
            return null;
        }
    }

    private static Codificador novoCodificador(String nomeOpus, int taxa) {
        if (nomeOpus != null) {
            try {
                return new CodificadorOpus(nomeOpus, taxa);
            } catch (Exception ignorado) {
                // Segue em μ-law.
            }
        }
        return new CodificadorPcmu(taxa);
    }

    private static void liberar(AudioRecord gravador) {
        if (gravador == null) return;
        try { gravador.stop(); } catch (Exception ignorado) { }
        gravador.release();
    }

    private final class Captura extends Thread {
        private final CountDownLatch aberta = new CountDownLatch(1);
        private final LinkedBlockingQueue<Object> finais = new LinkedBlockingQueue<>();
        private volatile boolean rodando = true;
        private volatile int falaPedida;
        private volatile Exception falha;

        Captura() {
            super("RadioVozCaptura");
        }

        void abrir() throws Exception {
            start();
            if (!aberta.await(2, TimeUnit.SECONDS)) {
                rodando = false;
                throw new IllegalStateException("O microfone demorou para abrir. Tente de novo.");
            }
            if (falha != null) throw falha;
        }

        boolean enviando() {
            return falaPedida != 0;
        }

        void enviar(int nova) {
            falaPedida = nova;
        }

        WritableMap pararEnvio() throws InterruptedException {
            if (falaPedida == 0) return null;
            falaPedida = 0;
            Object ultimo = finais.poll(800, TimeUnit.MILLISECONDS);
            return ultimo instanceof WritableMap ? (WritableMap) ultimo : null;
        }

        WritableMap encerrar() throws InterruptedException {
            WritableMap ultimo = pararEnvio();
            rodando = false;
            join(500);
            return ultimo;
        }

        // Conversa encerrada: fecha sem entregar o resto.
        void descartar() {
            falaPedida = 0;
            rodando = false;
        }

        @Override
        public void run() {
            Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO);
            AudioRecord gravador = null;
            int taxa = 0;
            String nomeOpus;
            try {
                for (int tentativa : new int[] { 48000, 16000, 44100, 8000 }) {
                    int minimo = AudioRecord.getMinBufferSize(tentativa, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                    if (minimo <= 0) continue;
                    AudioRecord candidato = new AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, tentativa,
                        AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(minimo, tentativa / 5 * 2));
                    if (candidato.getState() == AudioRecord.STATE_INITIALIZED) {
                        gravador = candidato;
                        taxa = tentativa;
                        break;
                    }
                    candidato.release();
                }
                if (gravador == null) throw new IllegalStateException("Microfone indisponível ou em uso por outro app.");
                gravador.startRecording();
                if (gravador.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) throw new IllegalStateException("Microfone em uso por outro app.");
                nomeOpus = codificadorOpus(taxa);
            } catch (Exception erro) {
                falha = erro;
                aberta.countDown();
                liberar(gravador);
                return;
            }
            aberta.countDown();

            short[] quadro = new short[taxa / 50];
            Codificador codificador = null;
            int falaAtual = 0;
            try {
                while (rodando) {
                    int lidos = gravador.read(quadro, 0, quadro.length);
                    if (lidos < 0) break;
                    int pedida = falaPedida;
                    if (pedida != falaAtual) {
                        // Fim (ou troca) de fala: esvazia o codificador e entrega o último pedaço.
                        if (falaAtual != 0) {
                            finais.offer(fechar(codificador, falaAtual));
                            codificador = null;
                        }
                        falaAtual = pedida;
                        if (falaAtual != 0) codificador = novoCodificador(nomeOpus, taxa);
                    }
                    // Enquanto o bipe toca (modo "pronto"), o som do microfone é descartado.
                    if (codificador == null || lidos == 0) continue;
                    codificador.codificar(quadro, lidos);
                    if (codificador.milissegundos() >= PEDACO_MS) emitir(falaAtual, codificador.nome(), codificador.retirar());
                }
            } catch (Exception ignorado) {
                // Libera o microfone abaixo.
            } finally {
                if (falaAtual != 0) finais.offer(fechar(codificador, falaAtual));
                liberar(gravador);
            }
        }
    }

    private interface Codificador {
        void codificar(short[] pcm, int quantidade);
        int milissegundos();
        byte[] retirar();
        byte[] fechar();
        String nome();
    }

    // Pacotes Opus de 20 ms, cada um precedido do tamanho em 2 bytes (big-endian).
    private static final class CodificadorOpus implements Codificador {
        private final MediaCodec codec;
        private final MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        private final ByteArrayOutputStream saida = new ByteArrayOutputStream();
        private final int taxa;
        private long pts;
        private int ms;

        CodificadorOpus(String nome, int taxa) throws Exception {
            this.taxa = taxa;
            MediaFormat formato = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_OPUS, taxa, 1);
            formato.setInteger(MediaFormat.KEY_BIT_RATE, 16000);
            MediaCodec criado = MediaCodec.createByCodecName(nome);
            try {
                criado.configure(formato, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
                criado.start();
            } catch (Exception erro) {
                criado.release();
                throw erro;
            }
            codec = criado;
        }

        @Override
        public void codificar(short[] pcm, int quantidade) {
            int indice = codec.dequeueInputBuffer(20000);
            if (indice >= 0) {
                ByteBuffer entrada = codec.getInputBuffer(indice);
                if (entrada != null) {
                    int cabe = Math.min(quantidade, entrada.capacity() / 2);
                    entrada.clear();
                    entrada.order(ByteOrder.LITTLE_ENDIAN);
                    for (int i = 0; i < cabe; i++) entrada.putShort(pcm[i]);
                    codec.queueInputBuffer(indice, 0, cabe * 2, pts, 0);
                    pts += cabe * 1000000L / taxa;
                } else {
                    codec.queueInputBuffer(indice, 0, 0, pts, 0);
                }
            }
            drenar(0);
        }

        // Devolve true quando o codificador terminou (fim do fluxo).
        private boolean drenar(long esperaUs) {
            while (true) {
                int indice = codec.dequeueOutputBuffer(info, esperaUs);
                if (indice == MediaCodec.INFO_TRY_AGAIN_LATER) return false;
                if (indice < 0) continue;
                boolean fim = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
                ByteBuffer pacote = codec.getOutputBuffer(indice);
                if (pacote != null && info.size > 0 && (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
                    byte[] bytes = new byte[info.size];
                    pacote.position(info.offset);
                    pacote.get(bytes, 0, info.size);
                    saida.write((info.size >> 8) & 0xFF);
                    saida.write(info.size & 0xFF);
                    saida.write(bytes, 0, bytes.length);
                    ms += 20;
                }
                codec.releaseOutputBuffer(indice, false);
                if (fim) return true;
            }
        }

        @Override
        public int milissegundos() {
            return ms;
        }

        @Override
        public byte[] retirar() {
            byte[] bytes = saida.toByteArray();
            saida.reset();
            ms = 0;
            return bytes;
        }

        @Override
        public byte[] fechar() {
            try {
                int indice = codec.dequeueInputBuffer(20000);
                if (indice >= 0) codec.queueInputBuffer(indice, 0, 0, pts, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                for (int tentativa = 0; tentativa < 15 && !drenar(10000); tentativa++) { }
            } catch (Exception ignorado) {
                // Entrega o que já saiu.
            } finally {
                try { codec.stop(); } catch (Exception ignorado) { }
                codec.release();
            }
            return retirar();
        }

        @Override
        public String nome() {
            return "opus";
        }
    }

    // G.711 μ-law a 8 kHz: a taxa do microfone é reduzida pela média de cada janela.
    private static final class CodificadorPcmu implements Codificador {
        private final ByteArrayOutputStream saida = new ByteArrayOutputStream();
        private final double razao;
        private double posicao;
        private double soma;
        private int contagem;

        CodificadorPcmu(int taxa) {
            razao = taxa / (double) TAXA_PCMU;
        }

        @Override
        public void codificar(short[] pcm, int quantidade) {
            for (int i = 0; i < quantidade; i++) {
                soma += pcm[i];
                contagem++;
                posicao += 1;
                if (posicao >= razao) {
                    posicao -= razao;
                    saida.write(linearParaMuLaw((int) Math.round(soma / contagem)));
                    soma = 0;
                    contagem = 0;
                }
            }
        }

        @Override
        public int milissegundos() {
            return saida.size() / 8;
        }

        @Override
        public byte[] retirar() {
            byte[] bytes = saida.toByteArray();
            saida.reset();
            return bytes;
        }

        @Override
        public byte[] fechar() {
            return retirar();
        }

        @Override
        public String nome() {
            return "pcmu";
        }
    }

    static int linearParaMuLaw(int amostra) {
        int s = Math.max(-32768, Math.min(32767, amostra));
        int sinal = s < 0 ? 0x80 : 0;
        if (sinal != 0) s = -s;
        if (s > 32635) s = 32635;
        s += 0x84;
        int expoente = 7;
        for (int mascara = 0x4000; (s & mascara) == 0 && expoente > 0; mascara >>= 1) expoente--;
        int mantissa = (s >> (expoente + 3)) & 0x0F;
        return ~(sinal | (expoente << 4) | mantissa) & 0xFF;
    }

    static int muLawParaLinear(int valor) {
        int u = ~valor & 0xFF;
        int sinal = u & 0x80, expoente = (u >> 4) & 0x07, mantissa = u & 0x0F;
        int s = (((mantissa << 3) + 0x84) << expoente) - 0x84;
        return sinal != 0 ? -s : s;
    }

    static short[] reamostrar(short[] entrada, int de, int para) {
        if (de == para || entrada.length == 0) return entrada;
        int total = Math.max(1, (int) ((long) entrada.length * para / de));
        short[] saida = new short[total];
        double passo = de / (double) para;
        for (int i = 0; i < total; i++) {
            double x = i * passo;
            int a = Math.min((int) x, entrada.length - 1);
            int b = Math.min(a + 1, entrada.length - 1);
            double t = x - a;
            saida[i] = (short) Math.round(entrada[a] * (1 - t) + entrada[b] * t);
        }
        return saida;
    }

    // Toca os pedaços na ordem em que chegam, com ~250 ms guardados no começo de cada fala.
    private final class Reproducao extends Thread {
        private final LinkedBlockingQueue<Object[]> fila = new LinkedBlockingQueue<>();
        private final MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        private final ArrayDeque<short[]> espera = new ArrayDeque<>();
        private volatile boolean rodando = true;
        private MediaCodec decodificador;
        private long ptsDecodificador;
        private int canais = 1;
        private int taxaDecodificador = TAXA_SAIDA;
        private int msEspera;

        Reproducao() {
            super("RadioVozReproducao");
        }

        void tocar(int falaRecebida, String codec, byte[] dados) {
            fila.offer(new Object[] { falaRecebida, codec, dados });
        }

        void fimFala() {
            fila.offer(new Object[0]);
        }

        void encerrar() {
            rodando = false;
            interrupt();
        }

        @Override
        public void run() {
            Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO);
            AudioTrack saida = null;
            int falaAtual = Integer.MIN_VALUE;
            boolean tocando = false, fimRecebido = false;
            long inicio = 0;
            try {
                saida = criarSaida();
                while (rodando) {
                    Object[] item = fila.poll(40, TimeUnit.MILLISECONDS);
                    if (item != null && item.length == 0) {
                        fimRecebido = true;
                    } else if (item != null) {
                        int recebida = (Integer) item[0];
                        if (recebida != falaAtual) {
                            // Nova fala: o resto da anterior toca antes, e a reserva recomeça.
                            if (!espera.isEmpty()) {
                                if (!tocando) saida.play();
                                tocando = true;
                                escrever(saida);
                            }
                            if (tocando) {
                                saida.stop();
                                tocando = false;
                            }
                            fecharDecodificador();
                            falaAtual = recebida;
                            fimRecebido = false;
                            inicio = SystemClock.elapsedRealtime();
                        }
                        try {
                            decodificar((String) item[1], (byte[]) item[2]);
                        } catch (Exception erro) {
                            // Pedaço inválido: recomeça o decodificador no próximo.
                            fecharDecodificador();
                        }
                    }
                    if (!tocando && !espera.isEmpty() && (msEspera >= RESERVA_MS || fimRecebido || SystemClock.elapsedRealtime() - inicio > 600)) {
                        saida.play();
                        tocando = true;
                    }
                    if (tocando && !espera.isEmpty()) escrever(saida);
                    // Fala encerrada: o AudioTrack termina de tocar o que já recebeu e para.
                    if (tocando && fimRecebido && espera.isEmpty()) {
                        saida.stop();
                        tocando = false;
                    }
                }
            } catch (InterruptedException ignorado) {
                // Rádio encerrado.
            } catch (Exception ignorado) {
                // Saída de áudio indisponível.
            } finally {
                fecharDecodificador();
                if (saida != null) {
                    try {
                        saida.pause();
                        saida.flush();
                    } catch (Exception ignorado) { }
                    saida.release();
                }
            }
        }

        private AudioTrack criarSaida() {
            int minimo = AudioTrack.getMinBufferSize(TAXA_SAIDA, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
            return new AudioTrack.Builder()
                .setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build())
                .setAudioFormat(new AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(TAXA_SAIDA)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build())
                .setBufferSizeInBytes(Math.max(minimo, TAXA_SAIDA * 2))
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build();
        }

        private void escrever(AudioTrack saida) {
            short[] pcm;
            while ((pcm = espera.poll()) != null) saida.write(pcm, 0, pcm.length);
            msEspera = 0;
        }

        private void guardar(short[] pcm) {
            if (pcm.length == 0) return;
            espera.add(pcm);
            msEspera += pcm.length * 1000 / TAXA_SAIDA;
        }

        private void decodificar(String codec, byte[] dados) throws Exception {
            if ("pcmu".equals(codec)) {
                short[] pcm = new short[dados.length];
                for (int i = 0; i < dados.length; i++) pcm[i] = (short) muLawParaLinear(dados[i] & 0xFF);
                guardar(reamostrar(pcm, TAXA_PCMU, TAXA_SAIDA));
                return;
            }
            if (!"opus".equals(codec)) return;
            if (decodificador == null) decodificador = criarDecodificadorOpus();
            int posicao = 0;
            while (posicao + 2 <= dados.length) {
                int tamanho = ((dados[posicao] & 0xFF) << 8) | (dados[posicao + 1] & 0xFF);
                posicao += 2;
                if (tamanho <= 0 || posicao + tamanho > dados.length) break;
                int indice = decodificador.dequeueInputBuffer(20000);
                if (indice >= 0) {
                    ByteBuffer entrada = decodificador.getInputBuffer(indice);
                    if (entrada != null) {
                        entrada.clear();
                        entrada.put(dados, posicao, tamanho);
                        decodificador.queueInputBuffer(indice, 0, tamanho, ptsDecodificador, 0);
                    } else {
                        decodificador.queueInputBuffer(indice, 0, 0, ptsDecodificador, 0);
                    }
                    ptsDecodificador += 20000;
                }
                posicao += tamanho;
                drenarDecodificador(0);
            }
            // O decodificador trabalha em paralelo: espera um instante para o pedaço sair inteiro agora.
            while (drenarDecodificador(5000) > 0) { }
        }

        private int drenarDecodificador(long esperaUs) {
            int saidas = 0;
            while (true) {
                int indice = decodificador.dequeueOutputBuffer(info, esperaUs);
                if (indice == MediaCodec.INFO_TRY_AGAIN_LATER) return saidas;
                if (indice == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    try {
                        MediaFormat formato = decodificador.getOutputFormat();
                        canais = Math.max(1, formato.getInteger(MediaFormat.KEY_CHANNEL_COUNT));
                        taxaDecodificador = formato.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                    } catch (Exception ignorado) { }
                    continue;
                }
                if (indice < 0) continue;
                ByteBuffer pcm = decodificador.getOutputBuffer(indice);
                if (pcm != null && info.size > 0) {
                    pcm.position(info.offset);
                    pcm.limit(info.offset + info.size);
                    ShortBuffer amostras = pcm.order(ByteOrder.nativeOrder()).asShortBuffer();
                    short[] mono = new short[amostras.remaining() / canais];
                    for (int i = 0; i < mono.length; i++) mono[i] = amostras.get(i * canais);
                    guardar(reamostrar(mono, taxaDecodificador, TAXA_SAIDA));
                    saidas++;
                }
                decodificador.releaseOutputBuffer(indice, false);
            }
        }

        // Cabeçalho Opus para pacotes crus (1 canal, 48 kHz), como o navegador e o Android geram.
        private MediaCodec criarDecodificadorOpus() throws Exception {
            MediaFormat formato = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_OPUS, TAXA_SAIDA, 1);
            byte[] cabecalho = { 'O', 'p', 'u', 's', 'H', 'e', 'a', 'd', 1, 1, 0x38, 0x01, (byte) 0x80, (byte) 0xBB, 0, 0, 0, 0, 0 };
            formato.setByteBuffer("csd-0", ByteBuffer.wrap(cabecalho));
            formato.setByteBuffer("csd-1", ByteBuffer.allocate(8).order(ByteOrder.nativeOrder()).putLong(0, 6500000L));
            formato.setByteBuffer("csd-2", ByteBuffer.allocate(8).order(ByteOrder.nativeOrder()).putLong(0, 80000000L));
            MediaCodec criado = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_AUDIO_OPUS);
            try {
                criado.configure(formato, null, null, 0);
                criado.start();
            } catch (Exception erro) {
                criado.release();
                throw erro;
            }
            canais = 1;
            taxaDecodificador = TAXA_SAIDA;
            ptsDecodificador = 0;
            return criado;
        }

        private void fecharDecodificador() {
            MediaCodec atual = decodificador;
            decodificador = null;
            if (atual == null) return;
            try { atual.stop(); } catch (Exception ignorado) { }
            atual.release();
        }
    }
}
