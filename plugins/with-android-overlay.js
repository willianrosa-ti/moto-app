const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

const OVERLAY_PACKAGE = 'com.millin.motorista.overlay';
const PERMISSOES_ANDROID = [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.USE_FULL_SCREEN_INTENT',
  'android.permission.VIBRATE',
  'android.permission.WAKE_LOCK',
];

function adicionarPermissoes(manifest) {
  const permissoes = manifest.manifest['uses-permission'] || [];

  PERMISSOES_ANDROID.forEach((nomePermissao) => {
    const existe = permissoes.some((permissao) => (
      permissao.$?.['android:name'] === nomePermissao
    ));

    if (!existe) {
      permissoes.push({ $: { 'android:name': nomePermissao } });
    }
  });

  manifest.manifest['uses-permission'] = permissoes;
  return manifest;
}

function adicionarServicoMonitor(manifest) {
  const aplicacao = manifest.manifest.application?.[0];
  if (!aplicacao) return manifest;

  const servicos = aplicacao.service || [];
  const nomeServico = `${OVERLAY_PACKAGE}.RideMonitorService`;
  const existente = servicos.find((servico) => servico.$?.['android:name'] === nomeServico);
  const atributos = {
    'android:name': nomeServico,
    'android:exported': 'false',
    'android:foregroundServiceType': 'remoteMessaging|location',
  };

  if (existente) {
    existente.$ = { ...existente.$, ...atributos };
  } else {
    servicos.push({ $: atributos });
  }

  aplicacao.service = servicos;
  return manifest;
}

function listarArquivos(diretorio) {
  if (!fs.existsSync(diretorio)) return [];

  return fs.readdirSync(diretorio, { withFileTypes: true }).flatMap((item) => {
    const caminho = path.join(diretorio, item.name);
    return item.isDirectory() ? listarArquivos(caminho) : [caminho];
  });
}

function encontrarArquivo(projectRoot, nomeArquivo) {
  const javaRoot = path.join(projectRoot, 'android', 'app', 'src', 'main', 'java');
  return listarArquivos(javaRoot).find((arquivo) => path.basename(arquivo) === nomeArquivo);
}

function limparMainActivity(caminhoMainActivity) {
  if (!caminhoMainActivity) return;

  let conteudo = fs.readFileSync(caminhoMainActivity, 'utf8');

  conteudo = conteudo
    .replace(/\nimport com\.millin\.motorista\.overlay\.OverlayHelper\n/g, '\n')
    .replace(/\nimport com\.millin\.motorista\.overlay\.OverlayHelper;\n/g, '\n')
    .replace(/^\s*OverlayHelper\.configure\(this,\s*"MIL-LIN"\)\s*\n/gm, '')
    .replace(/^\s*OverlayHelper\.configure\(this,\s*"MIL-LIN"\);\s*\n/gm, '')
    .replace(
      /\n\s*override fun onResume\(\) \{\s*\n\s*super\.onResume\(\)\s*\n\s*\}\s*\n/g,
      '\n'
    )
    .replace(
      /\n\s*@Override\s*\n\s*protected void onResume\(\) \{\s*\n\s*super\.onResume\(\);\s*\n\s*\}\s*\n/g,
      '\n'
    );

  fs.writeFileSync(caminhoMainActivity, conteudo);
}

function configurarMainApplication(caminhoMainApplication) {
  if (!caminhoMainApplication) return;

  let conteudo = fs.readFileSync(caminhoMainApplication, 'utf8');

  if (caminhoMainApplication.endsWith('.kt')) {
    if (!conteudo.includes('import com.millin.motorista.overlay.AppOverlayPackage')) {
      conteudo = conteudo.replace(
        /(package .+\n)/,
        '$1\nimport com.millin.motorista.overlay.AppOverlayPackage\n'
      );
    }

    if (!conteudo.includes('add(AppOverlayPackage())')) {
      conteudo = conteudo.replace(
        /(PackageList\(this\)\.packages\.apply \{\n)/,
        '$1              add(AppOverlayPackage())\n'
      );
    }
  } else {
    if (!conteudo.includes('import com.millin.motorista.overlay.AppOverlayPackage;')) {
      conteudo = conteudo.replace(
        /(package .+;\n)/,
        '$1\nimport com.millin.motorista.overlay.AppOverlayPackage;\n'
      );
    }

    if (!conteudo.includes('packages.add(new AppOverlayPackage())')) {
      conteudo = conteudo.replace(
        /(List<ReactPackage> packages = new PackageList\(this\)\.getPackages\(\);\n)/,
        '$1        packages.add(new AppOverlayPackage());\n'
      );
    }
  }

  fs.writeFileSync(caminhoMainApplication, conteudo);
}

function escreverArquivo(projectRoot, nomeArquivo, conteudo) {
  const destino = path.join(
    projectRoot,
    'android',
    'app',
    'src',
    'main',
    'java',
    ...OVERLAY_PACKAGE.split('.'),
    nomeArquivo
  );

  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, conteudo);
}

function copiarBuzina(projectRoot) {
  const origem = path.join(projectRoot, 'assets', 'sounds', 'buzina.mp3');
  const destino = path.join(
    projectRoot,
    'android',
    'app',
    'src',
    'main',
    'res',
    'raw',
    'buzina.mp3'
  );

  if (!fs.existsSync(origem)) return;

  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.copyFileSync(origem, destino);
}

function copiarServicoMonitor(projectRoot) {
  const origem = path.join(__dirname, 'native', 'RideMonitorService.java');
  if (!fs.existsSync(origem)) return;

  escreverArquivo(projectRoot, 'RideMonitorService.java', fs.readFileSync(origem, 'utf8'));
  for (const nome of ['DriverNotifications.java', 'DriverSessionSecrets.java']) {
    escreverArquivo(projectRoot, nome, fs.readFileSync(path.join(__dirname, 'native', nome), 'utf8'));
  }
}

function criarModuloOverlay(projectRoot) {
  escreverArquivo(projectRoot, 'AppOverlayPackage.java', `package ${OVERLAY_PACKAGE};

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.Collections;
import java.util.List;

public class AppOverlayPackage implements ReactPackage {
    @Override
    public List<NativeModule> createNativeModules(ReactApplicationContext reactContext) {
        return Collections.singletonList(new AppOverlayModule(reactContext));
    }

    @Override
    public List<ViewManager> createViewManagers(ReactApplicationContext reactContext) {
        return Collections.emptyList();
    }
}
`);

  escreverArquivo(projectRoot, 'AppOverlayModule.java', `package ${OVERLAY_PACKAGE};

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.res.AssetFileDescriptor;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.UiThreadUtil;
import com.facebook.react.bridge.WritableMap;
import com.millin.motorista.R;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

public class AppOverlayModule extends ReactContextBaseJavaModule {
    private static WindowManager windowManager;
    private static View overlayView;
    private static WindowManager.LayoutParams overlayParams;
    private static int initialX;
    private static int initialY;
    private static float initialTouchX;
    private static float initialTouchY;
    private static final Set<MediaPlayer> buzinasAtivas = Collections.synchronizedSet(new HashSet<>());

    private final ReactApplicationContext reactContext;

    public AppOverlayModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @Override
    public String getName() {
        return "AppOverlay";
    }

    @ReactMethod
    public void isSupported(Promise promise) {
        WritableMap resposta = Arguments.createMap();
        resposta.putBoolean("isSupported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.M);
        promise.resolve(resposta);
    }

    @ReactMethod
    public void hasPermission(Promise promise) {
        WritableMap resposta = Arguments.createMap();
        resposta.putBoolean("granted", temPermissaoSobreposicao());
        promise.resolve(resposta);
    }

    @ReactMethod
    public void requestPermission(Promise promise) {
        if (temPermissaoSobreposicao()) {
            WritableMap resposta = Arguments.createMap();
            resposta.putBoolean("granted", true);
            promise.resolve(resposta);
            return;
        }

        Intent intent = new Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:" + reactContext.getPackageName())
        );
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        try {
            Activity activity = getCurrentActivity();
            if (activity != null) {
                activity.startActivity(intent);
            } else {
                reactContext.startActivity(intent);
            }

            WritableMap resposta = Arguments.createMap();
            resposta.putBoolean("openedSettings", true);
            promise.resolve(resposta);
        } catch (ActivityNotFoundException erro) {
            abrirDetalhesDoApp();

            WritableMap resposta = Arguments.createMap();
            resposta.putBoolean("openedSettings", true);
            resposta.putString("fallback", "applicationDetails");
            promise.resolve(resposta);
        } catch (Exception erro) {
            promise.reject("E_OVERLAY_PERMISSION", "Nao foi possivel abrir a permissao de sobreposicao.", erro);
        }
    }

    @ReactMethod
    public void showOverlay(String label, Promise promise) {
        if (!temPermissaoSobreposicao()) {
            promise.reject("E_OVERLAY_PERMISSION_DENIED", "Permissao de sobreposicao nao concedida.");
            return;
        }

        UiThreadUtil.runOnUiThread(() -> {
            try {
                esconderOverlay();
                criarOverlay(label);
                promise.resolve(null);
            } catch (Exception erro) {
                promise.reject("E_OVERLAY_SHOW", "Nao foi possivel mostrar a sobreposicao.", erro);
            }
        });
    }

    @ReactMethod
    public void hideOverlay(Promise promise) {
        UiThreadUtil.runOnUiThread(() -> {
            try {
                esconderOverlay();
                promise.resolve(null);
            } catch (Exception erro) {
                promise.reject("E_OVERLAY_HIDE", "Nao foi possivel esconder a sobreposicao.", erro);
            }
        });
    }

    @ReactMethod
    public void playBuzina(Promise promise) {
        try {
            tocarBuzinaNativa();
            promise.resolve(null);
        } catch (Exception erro) {
            promise.reject("E_BUZINA_PLAY", "Nao foi possivel tocar a buzina.", erro);
        }
    }

    @ReactMethod
    public void startRideMonitor(String token, String apiBase, String refreshToken, boolean radarAtivo, Promise promise) {
        if (token == null || token.trim().isEmpty()) {
            promise.reject("E_RIDE_MONITOR_TOKEN", "Token do motorista indisponivel.");
            return;
        }

        try {
            Intent intent = new Intent(reactContext, RideMonitorService.class);
            intent.setAction(RideMonitorService.ACTION_START);
            intent.putExtra(RideMonitorService.EXTRA_TOKEN, token);
            intent.putExtra(RideMonitorService.EXTRA_API_BASE, apiBase);
            intent.putExtra("refreshToken", refreshToken);
            intent.putExtra("radarAtivo", radarAtivo);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactContext.startForegroundService(intent);
            } else {
                reactContext.startService(intent);
            }

            promise.resolve(null);
        } catch (Exception erro) {
            promise.reject("E_RIDE_MONITOR_START", "Nao foi possivel iniciar o monitor nativo de corridas.", erro);
        }
    }

    @ReactMethod
    public void stopRideMonitor(Promise promise) {
        try {
            Intent intent = new Intent(reactContext, RideMonitorService.class);
            intent.setAction(RideMonitorService.ACTION_STOP);
            reactContext.startService(intent);
            promise.resolve(null);
        } catch (Exception erro) {
            promise.reject("E_RIDE_MONITOR_STOP", "Nao foi possivel parar o monitor nativo de corridas.", erro);
        }
    }

    @ReactMethod
    public void setRideMonitorForeground(boolean appEmPrimeiroPlano, Promise promise) {
        RideMonitorService.setAppInForeground(appEmPrimeiroPlano);
        promise.resolve(null);
    }

    @ReactMethod
    public void notifyMessage(String id, String title, String text, Promise promise) {
        try { DriverNotifications.show(reactContext, id, title, text); promise.resolve(null); }
        catch (Exception error) { promise.reject("E_MESSAGE_NOTIFICATION", error); }
    }

    private boolean temPermissaoSobreposicao() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(reactContext);
    }

    private void tocarBuzinaNativa() throws Exception {
        MediaPlayer mediaPlayer = new MediaPlayer();
        AssetFileDescriptor arquivo = null;

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                mediaPlayer.setAudioAttributes(
                    new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                );
            } else {
                mediaPlayer.setAudioStreamType(AudioManager.STREAM_ALARM);
            }

            arquivo = reactContext.getResources().openRawResourceFd(R.raw.buzina);
            if (arquivo == null) {
                throw new IllegalStateException("Arquivo de buzina nao encontrado.");
            }

            mediaPlayer.setDataSource(arquivo.getFileDescriptor(), arquivo.getStartOffset(), arquivo.getLength());
            mediaPlayer.setVolume(1.0f, 1.0f);
            mediaPlayer.setLooping(false);
            buzinasAtivas.add(mediaPlayer);
            mediaPlayer.setOnCompletionListener(AppOverlayModule::liberarBuzina);
            mediaPlayer.setOnErrorListener((player, what, extra) -> {
                liberarBuzina(player);
                return true;
            });
            mediaPlayer.prepare();
            mediaPlayer.start();
        } catch (Exception erro) {
            liberarBuzina(mediaPlayer);
            throw erro;
        } finally {
            if (arquivo != null) {
                arquivo.close();
            }
        }
    }

    private static void liberarBuzina(MediaPlayer mediaPlayer) {
        if (mediaPlayer == null) return;

        buzinasAtivas.remove(mediaPlayer);
        try {
            mediaPlayer.release();
        } catch (Exception ignored) {
        }
    }

    private void abrirDetalhesDoApp() {
        Intent intent = new Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:" + reactContext.getPackageName())
        );
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        reactContext.startActivity(intent);
    }

    private void criarOverlay(String label) {
        windowManager = (WindowManager) reactContext.getSystemService(Context.WINDOW_SERVICE);

        LinearLayout sobreposicao = new LinearLayout(reactContext);
        sobreposicao.setOrientation(LinearLayout.HORIZONTAL);
        sobreposicao.setGravity(Gravity.CENTER);
        sobreposicao.setElevation(12);

        GradientDrawable fundo = new GradientDrawable();
        fundo.setColor(Color.parseColor("#111827"));
        fundo.setCornerRadius(18);
        sobreposicao.setBackground(fundo);

        TextView titulo = new TextView(reactContext);
        titulo.setText(label != null && label.length() <= 10 ? label : "MIL-LIN");
        titulo.setTextColor(Color.WHITE);
        titulo.setTextSize(13);
        titulo.setGravity(Gravity.CENTER);
        titulo.setTypeface(null, android.graphics.Typeface.BOLD);
        titulo.setPadding(20, 12, 10, 12);

        TextView fechar = new TextView(reactContext);
        fechar.setText("x");
        fechar.setTextColor(Color.WHITE);
        fechar.setTextSize(16);
        fechar.setGravity(Gravity.CENTER);
        fechar.setTypeface(null, android.graphics.Typeface.BOLD);
        fechar.setPadding(10, 8, 16, 8);
        fechar.setOnClickListener((view) -> esconderOverlay());

        titulo.setOnTouchListener(this::moverOuAbrirApp);
        sobreposicao.addView(titulo);
        sobreposicao.addView(fechar);

        int tipoJanela = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;

        overlayParams = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            tipoJanela,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        );
        overlayParams.gravity = Gravity.TOP | Gravity.START;
        overlayParams.x = 24;
        overlayParams.y = 180;

        overlayView = sobreposicao;
        windowManager.addView(overlayView, overlayParams);
    }

    private boolean moverOuAbrirApp(View view, MotionEvent event) {
        switch (event.getAction()) {
            case MotionEvent.ACTION_DOWN:
                initialX = overlayParams.x;
                initialY = overlayParams.y;
                initialTouchX = event.getRawX();
                initialTouchY = event.getRawY();
                return true;
            case MotionEvent.ACTION_MOVE:
                overlayParams.x = initialX + (int) (event.getRawX() - initialTouchX);
                overlayParams.y = initialY + (int) (event.getRawY() - initialTouchY);
                windowManager.updateViewLayout(overlayView, overlayParams);
                return true;
            case MotionEvent.ACTION_UP:
                float deslocamentoX = Math.abs(event.getRawX() - initialTouchX);
                float deslocamentoY = Math.abs(event.getRawY() - initialTouchY);
                if (deslocamentoX < 10 && deslocamentoY < 10) {
                    abrirApp();
                }
                return true;
            default:
                return false;
        }
    }

    private void abrirApp() {
        Intent intent = reactContext.getPackageManager().getLaunchIntentForPackage(reactContext.getPackageName());
        if (intent == null) return;

        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        reactContext.startActivity(intent);
    }

    private void esconderOverlay() {
        if (windowManager != null && overlayView != null) {
            windowManager.removeView(overlayView);
            overlayView = null;
        }
    }
}
`);
}

function removerHelperAntigo(projectRoot) {
  const caminho = path.join(
    projectRoot,
    'android',
    'app',
    'src',
    'main',
    'java',
    ...OVERLAY_PACKAGE.split('.'),
    'OverlayHelper.java'
  );

  if (fs.existsSync(caminho)) {
    fs.unlinkSync(caminho);
  }
}

module.exports = function withAndroidOverlay(config) {
  config = withAndroidManifest(config, (configMod) => {
    configMod.modResults = adicionarServicoMonitor(adicionarPermissoes(configMod.modResults));
    return configMod;
  });

  return withDangerousMod(config, ['android', (configMod) => {
    const projectRoot = configMod.modRequest.projectRoot;

    copiarBuzina(projectRoot);
    criarModuloOverlay(projectRoot);
    copiarServicoMonitor(projectRoot);
    removerHelperAntigo(projectRoot);
    configurarMainApplication(encontrarArquivo(projectRoot, 'MainApplication.kt') || encontrarArquivo(projectRoot, 'MainApplication.java'));
    limparMainActivity(encontrarArquivo(projectRoot, 'MainActivity.kt') || encontrarArquivo(projectRoot, 'MainActivity.java'));

    return configMod;
  }]);
};
