# BotView — webowy klient własnego bota Discord

Gotowa aplikacja WWW w **HTML/CSS/JavaScript + Node.js (Vercel Functions)**. Brak zewnętrznych bibliotek, `npm install`, bazy danych i osobnego serwera 24/7.

> **Uwaga:** To niezależny projekt inspirowany pomysłem DiscordBotClient, **nie** jest to port kodu 1:1 ani oficjalny klient Discorda. Nie jest powiązany z Discord Inc. Korzystaj z niego wyłącznie ze swoim botem i zgodnie z warunkami Discorda.

## Co działa

- Logowanie przez token **własnego bota** (tylko do pamięci bieżącej karty; bez zapisywania w `localStorage`, cookie, DB, pliku czy analityce).
- Lista serwerów, do których dodano bota (endpoint `GET /users/@me/guilds`).
- Lista kanałów po obliczeniu widoczności na podstawie ról i nadpisań uprawnień.
- Odczyt ostatnich 50 wiadomości i ładowanie wcześniejszych (przycisk nad czatem).
- Załączniki, obrazy, proste embedy i reakcje (podgląd).
- Wysyłanie zwykłych wiadomości, gdy bot ma odpowiednie uprawnienia; wzmianki masowe są wyłączone.
- Odświeżanie wiadomości co 20 sekund podczas aktywności karty i ręcznie (przycisk `↻`).
- Widok mobilny i wyszukiwarka kanałów (`Ctrl+K`).

## Instalacja na Vercel

1. Rozpakuj ZIP. Umieść **zawartość** folderu w nowym prywatnym repozytorium GitHub (w głównym katalogu repozytorium muszą znajdować się `index.html`, `vercel.json` i katalog `api`).
2. Na [vercel.com/new](https://vercel.com/new) wybierz **Import Git Repository** i wskaż to repozytorium.
3. W `Framework Preset` wybierz **Other** (projekt ma `framework: null`). **Root Directory:** `./`. Nie ustawiaj żadnych zmiennych środowiskowych. Nie jest wymagany build.
4. Wciśnij **Deploy**. Po wdrożeniu otwórz adres Vercel i wprowadź token swojego bota. **Nie publikuj tokenu w repozytorium ani plikach projektu.**

Alternatywnie, jeśli masz CLI Vercela, uruchom `vercel --prod` w katalogu projektu. Nie jest potrzebny osobny działający proces Node.js: funkcja `api/discord.js` uruchamia się automatycznie na Vercel.

## Lokalnie (opcjonalnie)

Wystarczy Node.js 22+ (dla wbudowanego testowego serwera):

```bash
npm start
```

Otwórz `http://localhost:3000`. Do pracy na Vercel nie uruchamiaj `npm start`.

## Testy

```bash
npm run check
npm test
```

Testy nie wymagają rzeczywistego tokenu Discorda ani połączenia z Discordem.

## Uprawnienia bota

Bot musi być dodany do serwera. Aby widzieć treść wiadomości, potrzebuje `View Channel` i `Read Message History` oraz dostępu do treści wiadomości zgodnie z aktualnymi zasadami Discorda, w tym włączonego `Message Content Intent`, jeśli jest wymagane i dostępne dla Twojego bota.

Jeśli treść wiadomości jest pusta, może to być ograniczenie `Message Content Intent`, nie błąd tego projektu. Nie próbuj obchodzić ograniczeń API.

## Ograniczenia

- To **nie jest** pełny Discord Web / dokładny port DiscordBotClient: brak rozmów głosowych, wideorozmów, prywatnych DM, aktywnych wątków z listy, moderacji, edycji i reakcji na wiadomości, nagrywania czy pluginów.
- Brak stałego połączenia Gateway / WebSocket. Odświeżanie jest przez REST co 20 s, co pozwala wdrożyć wszystko wyłącznie na Vercel bez ciągle uruchomionego serwera.
- Wątki forum/media nie są wyświetlane jako lista postów. Kanały głosowe są widoczne, ale to nie jest klient voice.
- Endpoint listy serwerów pokazuje maksymalnie 200 pozycji na żądanie; bardzo duże boty z shardingiem mogą wymagać rozszerzenia.
- Niektóre funkcje API mogą podlegać dodatkowym limitom lub wymaganiom Discorda.
- Zaprojektowany na jeden token w jednej karcie; po odświeżeniu trzeba wkleić token ponownie.

## Bezpieczeństwo

- **Nie udostępniaj linku do strony jako miejsca zbierania tokenów od innych osób.** Używaj tylko własnego wdrożenia w zaufanym koncie Vercel.
- Token trafia w treści żądań HTTPS do funkcji Vercel należącej do Twojego projektu, a potem do `discord.com/api/v10`. Nie jest umieszczany w URL i nie jest celowo zapisywany ani logowany.
- Operator hostingu musi mieć możliwość obsługi żądań — projekt nie zapewnia pełnego ukrycia tokenu przed administratorem infrastruktury. Dla maksymalnego bezpieczeństwa nie korzystaj z publicznych, cudzych hostowanych kopii.
- Jeśli token zostanie ujawniony, natychmiast zresetuj go w [Discord Developer Portal](https://discord.com/developers/applications).
- Odczyt wiadomości podlega uprawnieniom i zasadom platformy; unikaj publikowania cudzych prywatnych treści.

## Pliki

- `index.html`, `styles.css`, `app.js` — interfejs przeglądarkowy.
- `api/discord.js` — funkcja Node.js na Vercel, wąska lista dozwolonych endpointów Discord API.
- `vercel.json` — ustawienia Vercel oraz nagłówki bezpieczeństwa.
- `local-dev.mjs` — wyłącznie opcjonalny serwer lokalny.
- `tests/` — testy funkcji API.

Źródła: [oficjalne API Discord](https://discord.com/developers/docs/reference), [Vercel Functions](https://vercel.com/docs/functions), [DiscordBotClient](https://github.com/aiko-chan-ai/DiscordBotClient).
