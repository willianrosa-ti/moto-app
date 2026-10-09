package com.millin.motorista.overlay;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.media.MediaCodec;
import android.media.MediaFormat;
import android.os.Process;
import android.os.SystemClock;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.ShortBuffer;
import java.util.ArrayDeque;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

// Toca a voz do rádio pelo servidor: decodifica os pedaços (Opus ou μ-law) na ordem em que chegam, com ~250 ms
// guardados no começo de cada fala. Usado pelo rádio nativo (serviço, mesmo com o app fechado).
public final class RadioVozPlayer extends Thread {
    private static final int TAXA_SAIDA = 48000, TAXA_PCMU = 8000, RESERVA_MS = 250;

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

    private final LinkedBlockingQueue<Object[]> fila = new LinkedBlockingQueue<>();
    private final MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
    private final ArrayDeque<short[]> espera = new ArrayDeque<>();
    private volatile boolean rodando = true;
    private MediaCodec decodificador;
    private long ptsDecodificador;
    private int canais = 1;
    private int taxaDecodificador = TAXA_SAIDA;
    private int msEspera;

    public RadioVozPlayer() {
        super("RadioVozReproducao");
    }

    public void tocar(int falaRecebida, String codec, byte[] dados) {
        fila.offer(new Object[] { falaRecebida, codec, dados });
    }

    public void fimFala() {
        fila.offer(new Object[0]);
    }

    public void encerrar() {
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
